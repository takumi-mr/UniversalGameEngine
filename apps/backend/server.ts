// apps/backend/server.ts
import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { UniversalEngine } from '@engine/shared/UniversalEngine';
import { HybridGameRepository } from './infra/HybridGameRepository';
import { gameRegistry } from '@engine/shared/GameRegistry';
import jwt from 'jsonwebtoken';
import { GenericGameServer } from '@engine/shared/network/GenericGameServer';

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

// --- HTTP Endpoints ---

// アクティブなルーム一覧の取得
app.get('/rooms', (req, res) => {
    const roomList = Array.from(sessions.entries()).map(([id, session]) => ({
        id,
        type: session.type,
        playerCount: io.sockets.adapter.rooms.get(id)?.size ?? 0
    }));
    res.json({ rooms: roomList });
});

// ゲーム種別ごとのルーム一覧
app.get('/rooms/:gameType', (req, res) => {
    const gameType = req.params.gameType.toLowerCase();
    const roomList = Array.from(sessions.entries())
        .filter(([_, session]) => session.type.toLowerCase() === gameType)
        .map(([id, session]) => ({
            id,
            type: session.type,
            playerCount: io.sockets.adapter.rooms.get(id)?.size ?? 0
        }));
    res.json({ rooms: roomList });
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

class SocketGameServer extends GenericGameServer<any, any> {
    constructor(roomId: string, engine: UniversalEngine<any, any>) {
        super(roomId, engine);
    }

    public override broadcastState(): void {
        const state = this.engine.getState();
        const players = state.players ? Object.values(state.players).filter(Boolean) as string[] : [];

        io.in(this.roomId).fetchSockets().then(sockets => {
            for (const socket of sockets) {
                const userId = socket.data.userId;
                const targetId = players.includes(userId) ? userId : 'SPECTATOR';
                const maskedState = this.engine.getMaskedState(targetId);
                socket.emit('state-update', maskedState);
            }
        }).catch(err => console.error("Broadcast error:", err));
    }
}

/**
 * セッション管理
 * エンジン本体と、そのゲームの種類(type)をセットで保持
 */
interface GameSession {
    server: SocketGameServer;
    type: string;
}
const sessions = new Map<string, GameSession>();

const repo = new HybridGameRepository<any>(
    process.env.REDIS_URL || 'redis://localhost:6379',
    process.env.MONGO_URL || 'mongodb://localhost:27017'
);

// --- HTTP Polling Endpoints ---
app.get('/game/:gameId/state', async (req, res) => {
    const gameId = req.params.gameId;
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'No token' });

    try {
        const token = authHeader.split(' ')[1];
        if (!token) return res.status(401).json({ error: 'No token' });
        const decoded = jwt.verify(token, JWT_SECRET) as any;
        const userId = decoded.userId as string;

        let session = sessions.get(gameId.toLowerCase());
        if (!session) {
            const savedData = await repo.load(gameId);
            if (savedData) {
                const def = gameRegistry.getDefinition(savedData.type);
                if (def) {
                    const engine = new UniversalEngine(def.ruleset);
                    engine.loadState(savedData.state);
                    const server = new SocketGameServer(gameId, engine);
                    sessions.set(gameId, { server, type: savedData.type });
                    session = sessions.get(gameId);
                }
            } else {
                return res.status(404).json({ error: 'Game not found' });
            }
        }

        const state = session!.server.getPollingState(userId);
        res.json({ state });
    } catch (err) {
        res.status(401).json({ error: 'Invalid token computation' });
    }
});

app.post('/game/:gameId/action', async (req, res) => {
    const gameId = req.params.gameId;
    const action = req.body;
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'No token' });

    try {
        const token = authHeader.split(' ')[1];
        if (!token) return res.status(401).json({ error: 'No token' });
        const decoded = jwt.verify(token, JWT_SECRET) as any;
        const userId = decoded.userId as string;

        const session = sessions.get(gameId);
        if (!session) return res.status(404).json({ error: 'Game not found' });

        const success = session.server.handleAction(userId, action);
        if (success) {
            const state = session.server.engine.getState();
            await repo.save(gameId, state, state.status === 'FINISHED');
            res.json({ success: true, state: session.server.getPollingState(userId) });
        } else {
            res.status(400).json({ error: 'Invalid action or not your turn' });
        }
    } catch (err) {
        res.status(401).json({ error: 'Invalid token' });
    }
});


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
        const def = gameRegistry.getDefinition(type.toLowerCase());
        if (!def) {
            console.error(`Unknown game type: ${type}`);
            socket.emit('error-message', `Unknown game type: ${type}`);
            return;
        }

        try {
            console.log(`Creating game: ${type} for user ${userId}`);
            const gameId = Math.random().toString(36).substring(7);
            const normalizedType = type.toLowerCase().replace(/-/g, '_');
            const engine = new UniversalEngine(def.ruleset, options);
            const server = new SocketGameServer(gameId, engine);
            sessions.set(gameId, { server, type: normalizedType });

            // 作成した本人に ID を送り返す
            socket.emit('game-created', gameId);
            console.log(`Game ${gameId} created via WebSocket by ${userId}`);
        } catch (error) {
            console.error(`Failed to create game ${type}:`, error);
            socket.emit('error-message', `Failed to create game: ${(error as any).message || error}`);
        }
    });

    // ルーム（ゲーム）への参加
    socket.on('join-game', async (gameId: string) => {
        socket.join(gameId);

        // メモリになければDBから復元を試みる
        if (!sessions.has(gameId.toLowerCase())) {
            const savedData = await repo.load(gameId);
            if (savedData) {
                const def = gameRegistry.getDefinition(savedData.type);
                if (def) {
                    const engine = new UniversalEngine(def.ruleset);
                    engine.loadState(savedData.state);
                    const normalizedType = savedData.type.toLowerCase().replace(/-/g, '_');
                    const server = new SocketGameServer(gameId, engine);
                    sessions.set(gameId, { server, type: normalizedType });
                    console.log(`Game ${gameId} restored from storage (${savedData.type})`);
                }
            }
        }

        const session = sessions.get(gameId);
        if (!session) {
            socket.emit('error-message', 'Game session not found');
            return;
        }

        const state = session.server.engine.getState();

        // プレイヤーの自動割り当てロジック (空いている席に座る)
        if (state.players) {
            let updated = false;
            // 既に自分が割り当てられているかチェック
            const isAlreadyAssigned = Object.values(state.players).includes(userId);

            if (!isAlreadyAssigned) {
                // 1. 全てのスロットをチェックして最初の空いているスロット (null) に割り当てる
                const emptySlotEntry = Object.entries(state.players).find(([_, val]) => val === null);
                if (emptySlotEntry) {
                    const [slotKey] = emptySlotEntry;
                    state.players[slotKey] = userId;
                    updated = true;
                    console.log(`Assigned ${userId} to slot "${slotKey}" in game ${gameId}`);
                }
                
                // 2. ルールセットが JOIN アクションをサポートしている場合、それをディスパッチして playerData 等を初期化
                const joinAction = { type: 'JOIN', playerId: userId } as any;
                if (session.server.engine.dispatch(joinAction)) {
                    updated = true;
                    console.log(`User ${userId} joined game ${gameId} via JOIN action`);
                }
            }

            // 状態が更新された場合は保存し、全員にブロードキャスト
            if (updated) {
                // Minimum player check and transition to 'PLAYING'
                const currentPlayers = Object.values(state.players).filter(p => p !== null).length;
                const normalizedType = session.type.toLowerCase().replace(/-/g, '_');
                const def = gameRegistry.getDefinition(normalizedType);
                if (state.status === 'WAITING' && def && currentPlayers >= def.minPlayers) {
                    state.status = 'PLAYING';
                    console.log(`Game ${gameId} transitioned to PLAYING status.`);
                }
                await repo.save(gameId, session.server.engine.getState(), false);
            }
        }

        // 参加した瞬間に現在の状態を送信
        console.log(`User ${userId} (socket: ${socket.id}) joined room ${gameId}`);
        const players = state.players ? Object.values(state.players).filter(Boolean) as string[] : [];
        const isPlayer = players.includes(userId);
        const targetId = isPlayer ? userId : 'SPECTATOR';
        const maskedState = session.server.engine.getMaskedState(targetId);
        socket.emit('state-update', maskedState);

        if (state.players && Object.values(state.players).some(p => p !== null)) {
            session.server.broadcastState(); // 割り当てがあった場合、全員に通知 (マスク対応)
        }
        updatePresence(gameId);
    });

    // 着手アクションの受信
    socket.on('dispatch-action', async ({ gameId, action }) => {
        const session = sessions.get(gameId);
        if (!session) return;

        // 【追加】PLAYING状態でない場合は、JOIN以外の全アクションを拒否
        const currentState = session.server.engine.getState();
        if (currentState.status !== 'PLAYING' && action.type !== 'JOIN') {
            console.warn(`[Blocked] Action ${action.type} for game ${gameId} blocked - status is ${currentState.status}`);
            socket.emit('error-message', 'Game is not in PLAYING status');
            return;
        }

        // GenericGameServer の handleAction は playerId の強制上書きや broadcastState() を内包する
        const success = session.server.handleAction(socket.data.userId, action);

        if (success) {
            const state = session.server.engine.getState();
            // 状態を永続化（終了フラグをチェックしてMongoDBへの保存判断）
            await repo.save(gameId, state, state.status === 'FINISHED');
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