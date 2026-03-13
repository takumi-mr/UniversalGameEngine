// apps/backend/server.ts
import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { UniversalEngine } from '@engine/shared/UniversalEngine';
import { HybridGameRepository } from './infra/HybridGameRepository';

const repo = new HybridGameRepository<any>(
    process.env.REDIS_URL || 'redis://localhost:6379',
    process.env.MONGO_URL || 'mongodb://localhost:27017'
);
import { OthelloRuleset } from '@engine/shared/rules/OthelloRules';

const app = express();
app.use(cors());

const httpServer = createServer(app);
const io = new Server(httpServer, {
    cors: { origin: "*" } // 開発用
});

const sessions = new Map<string, UniversalEngine<any, any>>();

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
    socket.on('request-create-game', (options) => {
        const gameId = Math.random().toString(36).substring(7);
        const engine = new UniversalEngine(OthelloRuleset, options);
        sessions.set(gameId, engine);
        
        // 作成した本人に ID を送り返す
        socket.emit('game-created', gameId);
        console.log(`Game ${gameId} created via WebSocket`);
    });

    // ルーム（ゲーム）への参加
    socket.on('join-game', async (gameId: string) => {
        socket.join(gameId);
        
        // メモリになければDBから復元を試みる
        if (!sessions.has(gameId)) {
            const savedState = await repo.load(gameId);
            if (savedState) {
                const engine = new UniversalEngine(OthelloRuleset);
                // 汎用エンジンに状態を直接流し込む口が必要
                engine.loadState(savedState); 
                sessions.set(gameId, engine);
            }
        }

        let engine = sessions.get(gameId);
        if (!engine) {
            // なければ新規作成（本来はREST APIと分けても良い）
            engine = new UniversalEngine(OthelloRuleset, { size: 4 });
            sessions.set(gameId, engine);
        }
        
        // 参加した瞬間に現在の状態を送信
        socket.emit('state-update', engine.getState());
        console.log(`User ${socket.id} joined room ${gameId}`);
        updatePresence(gameId);
    });

    // 着手アクションの受信
    socket.on('dispatch-action', async ({ gameId, action }) => {
        const engine = sessions.get(gameId);
        if (!engine) return;

        const success = engine.dispatch(action);
        if (success) {
            const state = engine.getState();
            // 状態を永続化（終了フラグをチェックしてMongoDBへの保存判断）
            await repo.save(gameId, state, state.status === 'FINISHED');
            // ルーム内の全員に最新の状態をブロードキャスト（リアルタイム反映！）
            io.to(gameId).emit('state-update', engine.getState());
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