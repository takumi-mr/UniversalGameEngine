// apps/backend/server.ts
import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { UniversalEngine } from '@engine/shared/UniversalEngine';
import { HybridGameRepository } from './infra/HybridGameRepository';
import { gameRegistry } from '@engine/shared/GameRegistry';

const app = express();
app.use(cors());

const httpServer = createServer(app);
const io = new Server(httpServer, {
    cors: { origin: "*" } // 開発用
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
    console.log(`User connected: ${socket.id}`);

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
        console.log(`Game ${gameId} created via WebSocket`);
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
        
        // 参加した瞬間に現在の状態を送信
        console.log(`User ${socket.id} joined room ${gameId}`);
        socket.emit('state-update', session.engine.getState());
        updatePresence(gameId);
    });

    // 着手アクションの受信
    socket.on('dispatch-action', async ({ gameId, action }) => {
        const session = sessions.get(gameId);
        if (!session) return;

        const success = session.engine.dispatch(action);
        if (success) {
            const state = session.engine.getState();
            // 状態を永続化（終了フラグをチェックしてMongoDBへの保存判断）
            await repo.save(gameId, state, state.status === 'FINISHED');
            // ルーム内の全員に最新の状態をブロードキャスト（リアルタイム反映！）
            io.to(gameId).emit('state-update', state);
        } else {
            socket.emit('error-message', 'Invalid move!');
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
        console.log(`User disconnected: ${socket.id}`);
    });
});

httpServer.listen(3000, () => {
    console.log("🚀 Realtime Engine Platform running on port 3000");
});