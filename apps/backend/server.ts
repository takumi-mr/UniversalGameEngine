// apps/backend/server.ts
import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { UniversalEngine } from '@engine/shared/UniversalEngine';
import { HybridGameRepository } from './infra/HybridGameRepository';
import { gameRegistry } from '@engine/shared/GameRegistry';
import jwt from 'jsonwebtoken';

process.on('uncaughtException', (err) => {
    console.error('[UNCAUGHT EXCEPTION]', err);
});
process.on('unhandledRejection', (reason, promise) => {
    console.error('[UNHANDLED REJECTION]', reason);
});

const app = express();
app.use(cors());
app.use(express.json());

const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-key';

// モックユーザーのログインエンドポイント
// 実際のシステムではDBから検証する
app.post('/login', (req, res) => {
    const { username, password } = req.body;
    
    // 簡易的な検証: パスワードは問わず、適当なユーザーIDとしてトークンを発行
    if (username) {
        const token = jwt.sign({ userId: username }, JWT_SECRET, { expiresIn: '24h' });
        res.json({ token, userId: username });
    } else {
        res.status(400).json({ error: 'Username is required' });
    }
});

const httpServer = createServer(app);
const io = new Server(httpServer, {
    cors: { origin: "*" } // 開発用
});

// Socket.IO ミドルウェア: JWTの検証を行う
io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    console.log(`[Socket Middleware] Connection attempt. ID: ${socket.id}, Token present: ${!!token}`);
    if (!token) {
        console.error(`[Socket Middleware] Authentication error: No token provided for ${socket.id}`);
        return next(new Error('Authentication error'));
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET) as { userId: string };
        socket.data.userId = decoded.userId;
        console.log(`[Socket Middleware] Authentication SUCCESS for ${socket.id}, User: ${decoded.userId}`);
        next();
    } catch (err) {
        console.error(`[Socket Middleware] Invalid token for ${socket.id}: ${err}`);
        next(new Error('Invalid token'));
    }
});

/**
 * セッション管理
 * エンジン本体と、そのゲームの種類(type)をセットで保持
 */
interface GameSession {
    engine: UniversalEngine<any, any>;
    type: string;
}
const sessions = new Map<string, GameSession>();

const repo = new HybridGameRepository<any>(
    process.env.REDIS_URL || 'redis://localhost:6379',
    process.env.MONGO_URL || 'mongodb://localhost:27017'
);


const updatePresence = (gameId: string) => {
    const room = io.sockets.adapter.rooms.get(gameId);
    const count = room ? room.size : 0;
    
    // ルーム内の全員に現在の人数などを送信
    io.to(gameId).emit('metadata-update', {
        playerCount: Math.min(count, 2), // 例えば2人までをプレイヤーとする
        spectatorCount: Math.max(0, count - 2),
        activePlayers: Array.from(room || [])
    });
};

io.on('connection', (socket) => {
    const userId = socket.data.userId;
    console.log(`User connected: ${socket.id} (User ID: ${userId})`);

    // 部屋の作成リクエスト
    socket.on('request-create-game', ({ type, options }) => {
        const def = gameRegistry.getDefinition(type);
        if (!def) {
            socket.emit('error-message', `Unknown game type: ${type}`);
            return;
        }

        const gameId = Math.random().toString(36).substring(7);
        const engine = new UniversalEngine(def.ruleset, options);
        sessions.set(gameId, { engine, type });
        
        // 作成した本人に ID を送り返す
        socket.emit('game-created', gameId);
        console.log(`Game ${gameId} created via WebSocket by ${userId}`);
    });

    // ルーム（ゲーム）への参加
    socket.on('join-game', async (gameId: string) => {
        socket.join(gameId);
        
        // メモリになければDBから復元を試みる
        if (!sessions.has(gameId)) {
            const savedData = await repo.load(gameId);
            if (savedData) {
                const def = gameRegistry.getDefinition(savedData.type);
                if (def) { 
                    const engine = new UniversalEngine(def.ruleset);
                    engine.loadState(savedData.state); 
                    sessions.set(gameId, { engine, type: savedData.type });
                    console.log(`Game ${gameId} restored from storage (${savedData.type})`);
                }
            }
        }

        const session = sessions.get(gameId);
        if (!session) {
            socket.emit('error-message', 'Game session not found');
            return;
        }
        
        const state = session.engine.getState();

        // プレイヤーの自動割り当てロジック (空いている席に座る)
        if (state.players) {
            let updated = false;
            // 既に自分が割り当てられているかチェック
            const isAlreadyAssigned = Object.values(state.players).includes(userId);
            
            if (!isAlreadyAssigned) {
                // 黒番(1)が空いていれば座る。次に白番(-1)が空いていれば座る。
                if (state.players[1] === null) {
                    state.players[1] = userId;
                    updated = true;
                    console.log(`Assigned ${userId} to Black (1) in game ${gameId}`);
                } else if (state.players[-1] === null) {
                    state.players[-1] = userId;
                    updated = true;
                    console.log(`Assigned ${userId} to White (-1) in game ${gameId}`);
                }
            }

            // 状態が更新された場合は保存し、全員にブロードキャスト
            if (updated) {
                await repo.save(gameId, state, false);
            }
        }

        // 参加した瞬間に現在の状態を送信
        console.log(`User ${userId} (socket: ${socket.id}) joined room ${gameId}`);
        socket.emit('state-update', state);
        if (state.players && Object.values(state.players).some(p => p !== null)) {
             io.to(gameId).emit('state-update', state); // 割り当てがあった場合、全員に通知
        }
        updatePresence(gameId);
    });

    // 着手アクションの受信
    socket.on('dispatch-action', async ({ gameId, action }) => {
        const session = sessions.get(gameId);
        if (!session) return;

        // 【セキュリティ強化】送信元のユーザーIDを強制的にアクションに付与する
        const actionWithPlayerId = { ...action, playerId: socket.data.userId };

        const success = session.engine.dispatch(actionWithPlayerId);
        if (success) {
            const state = session.engine.getState();
            // 状態を永続化（終了フラグをチェックしてMongoDBへの保存判断）
            await repo.save(gameId, state, state.status === 'FINISHED');
            // ルーム内の全員に最新の状態をブロードキャスト（リアルタイム反映！）
            io.to(gameId).emit('state-update', state);
        } else {
            socket.emit('error-message', 'Invalid move or not your turn!');
        }
    });

    socket.on('disconnect', () => {
        // 切断直前に所属していた全ルームに対して更新をかける
        for (const room of socket.rooms) {
            if (sessions.has(room)) {
                // 少し遅延させないと、自分自身が含まれたカウントになってしまう場合がある
                process.nextTick(() => updatePresence(room));
            }
        }
        console.log(`User disconnected: ${socket.id} (User ID: ${userId})`);
    });
});

httpServer.listen(3000, () => {
    console.log("🚀 Realtime Engine Platform running on port 3000");
});