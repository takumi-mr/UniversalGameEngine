import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import { JWT_SECRET } from '../config';
import { sessions, repo, SocketGameServer } from '../store/sessionStore';
import { gameRegistry } from '@engine/shared/GameRegistry';
import { UniversalEngine } from '@engine/shared/UniversalEngine';
import { setIoInstance, scheduleRoomCleanup, clearRoomCleanup, updatePresence } from './roomManager';

export const setupSocketIO = (io: Server) => {
    setIoInstance(io);

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
                const server = new SocketGameServer(gameId, engine, io);
                sessions.set(gameId, { server, type: normalizedType });

                // 作成した本人に ID を送り返す
                socket.emit('game-created', gameId);
                console.log(`Game ${gameId} created via WebSocket by ${userId}`);

                // 誰もいない状態で作成されるため、すぐにクリーンアップ対象にする（参加しなければ5分後に消える）
                scheduleRoomCleanup(gameId);
            } catch (error) {
                console.error(`Failed to create game ${type}:`, error);
                socket.emit('error-message', `Failed to create game: ${(error as any).message || error}`);
            }
        });

        // ルーム（ゲーム）への参加
        socket.on('join-game', async (gameId: string) => {
            clearRoomCleanup(gameId);
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
                        const server = new SocketGameServer(gameId, engine, io);
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
            const players = state.players ? (Object.values(state.players).filter(Boolean) as string[]) : [];
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

        socket.on('disconnecting', () => {
            // 切断直前に所属していた全ルームに対して更新をかける
            for (const room of socket.rooms) {
                if (sessions.has(room)) {
                    process.nextTick(() => updatePresence(room));
                }
            }
            console.log(`User disconnecting: ${socket.id} (User ID: ${userId})`);
        });

        socket.on('disconnect', () => {
            // console.log(`User disconnected: ${socket.id} (User ID: ${userId})`);
        });
    });
};
