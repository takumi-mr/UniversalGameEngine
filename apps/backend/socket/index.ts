import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import { JWT_SECRET } from '../config';
import { sessions, repo, SocketGameServer } from '../store/sessionStore';
import { gameRegistry } from '@engine/shared/GameRegistry';
import { UniversalEngine } from '@engine/shared/UniversalEngine';
import { setIoInstance, scheduleRoomCleanup, clearRoomCleanup, updatePresence } from './roomManager';
import { streamManager } from '../network/StreamManager';
import { GrpcBotPlayer } from '@engine/shared/ai/GrpcBotPlayer';
import { RandomPlayer } from '@engine/shared/ai/RandomPlayer';
import { MinimaxPlayer } from '@engine/shared/ai/MinimaxPlayer';
import { MCTSPlayer } from '@engine/shared/ai/MCTSPlayer';
import { aiTensorRegistry } from '@engine/shared/ai/AITensorAdapterRegistry';

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

                // AI追加のリクエストがあれば初期化する
                if (options?.addAi) {
                    const state = engine.getState();
                    if (state.players) {
                        const slotKeys = Object.keys(state.players);
                        if (slotKeys.length > 0) {
                            const aiSlotKey = slotKeys[slotKeys.length - 1] as string; // 人間が先に入れるように後方のスロットをAIにする
                            const botId = 'bot_' + Math.random().toString(36).substring(7);
                            state.players[aiSlotKey] = botId;

                            let botPlayer: any = null;
                            const aiType = options.addAi;

                            if (aiType === 'grpc_bot') {
                                botPlayer = new GrpcBotPlayer(botId, "gRPC External Bot", (turnState, legalActions) => {
                                    const adapter = aiTensorRegistry.getAdapter(normalizedType);
                                    if (adapter) {
                                        const stateTensor = adapter.encodeState(turnState, botId);
                                        const legalActionIds = turnState.activePlayers?.includes(botId) 
                                            ? adapter.encodeLegalActions(turnState, botId) 
                                            : [];
                                        streamManager.notifyBotTurn(gameId, botId, stateTensor, legalActionIds);
                                    }
                                });
                            } else if (aiType === 'random') {
                                botPlayer = new RandomPlayer(botId, "Random AI");
                            } else if (aiType === 'minimax') {
                                botPlayer = new MinimaxPlayer(botId, "Minimax AI", 3); // Depth 3
                            } else if (aiType === 'mcts') {
                                botPlayer = new MCTSPlayer(botId, "MCTS AI", 1000); // 1000 iterations
                            }

                            if (botPlayer) {
                                server.aiPlayers.set(botId, botPlayer);
                                console.log(`[AI] Spawned ${aiType} ${botId} in game ${gameId}`);
                            }
                        }
                    }
                }

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
        socket.on('join-game', async (gameId: string, options?: { asSpectator?: boolean }) => {
            const asSpectator = options?.asSpectator ?? false;
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
            if (state.players && !asSpectator) {
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
                    // Use a Set to count unique non-null players
                    const uniquePlayersCount = new Set(Object.values(state.players).filter(p => p !== null)).size;
                    const normalizedType = session.type.toLowerCase().replace(/-/g, '_');
                    const def = gameRegistry.getDefinition(normalizedType);

                    if (state.status === 'WAITING' && def && uniquePlayersCount >= def.minPlayers) {
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

                // プレイヤーとして割り当てられているならプレイヤー専用ルームにも入る
                if (Object.values(state.players).includes(userId)) {
                    socket.join(`${gameId}:players`);
                    console.log(`User ${userId} joined players-only room for ${gameId}`);
                }
            }
            updatePresence(gameId);
        });

        // ルームからの退出
        socket.on('leave-game', async (gameId: string) => {
            console.log(`User ${userId} requested to leave game ${gameId}`);
            const session = sessions.get(gameId);
            if (session) {
                const state = session.server.engine.getState();
                if (state.players) {
                    // プレイヤーとして割り当てられていた場合、スロットをクリアする
                    let updated = false;
                    for (const [key, val] of Object.entries(state.players)) {
                        if (val === userId) {
                            state.players[key] = null;
                            updated = true;
                            console.log(`Cleared slot "${key}" for user ${userId} in game ${gameId}`);
                        }
                    }
                    if (updated) {
                        await repo.save(gameId, state, false);
                        session.server.broadcastState();
                    }
                }
            }
            socket.leave(gameId);
            socket.leave(`${gameId}:players`);
            updatePresence(gameId);
        });

        // チャットメッセージの送信
        socket.on('send-chat', async ({ gameId, message, channel, recipientId }) => {
            if (!message || typeof message !== 'string') return;
            const session = sessions.get(gameId);
            if (!session) return;

            const chatPayload = {
                userId,
                message,
                channel: channel === 'private' ? 'private' : 'public',
                recipientId, // 指定された宛先
                timestamp: new Date().toISOString()
            };

            if (channel === 'private') {
                const state = session.server.engine.getState();
                const players = state.players ? (Object.values(state.players).filter(Boolean) as string[]) : [];
                if (!players.includes(userId)) {
                    console.warn(`[Chat] User ${userId} attempted to send private chat but is not a player in ${gameId}`);
                    return;
                }

                if (recipientId && recipientId !== 'all') {
                    // 特定の個人への送信
                    // 送信者と受信者にのみ送信する
                    // Socket.IOでは room への emit が基本だが、個別送信の場合は to(userId) を使う
                    // Note: userId は socket.data.userId に紐付いているので、
                    // サーバー全体のソケットからその userId を持つソケットを探すか、
                    // プレイヤーごとのIDをルーム名として使っている場合はそれを利用する。
                    // ここではシンプルに、全てのソケットから userId が一致するものをフィルタリングして送信する。
                    const targetSockets = await io.in(gameId).fetchSockets();
                    for (const s of targetSockets) {
                        if (s.data.userId === recipientId || s.data.userId === userId) {
                            s.emit('chat-message', chatPayload);
                        }
                    }
                } else {
                    // プレイヤー全員に送信
                    io.to(`${gameId}:players`).emit('chat-message', chatPayload);
                }
            } else {
                // 全体に送信
                io.to(gameId).emit('chat-message', chatPayload);
            }

            // 3. gRPCストリームへの通知
            streamManager.broadcast(gameId, {
                chatMessage: chatPayload
            });

            console.log(`[Chat] ${userId} sent ${channel || 'public'} message to ${gameId} (recipient: ${recipientId || 'all'})`);
        });

        // 着手アクションの受信
        socket.on('dispatch-action', async ({ gameId, action }) => {
            const session = sessions.get(gameId);
            if (!session) return;

            const currentState = session.server.engine.getState();
            if (currentState.status !== 'PLAYING' && action.type !== 'JOIN' && action.type !== 'RESET' && action.type !== 'START') {
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

        // フルデータの再同期リクエスト
        socket.on('request-full-state', ({ gameId }) => {
            const session = sessions.get(gameId);
            if (session) {
                console.log(`[Socket] User ${userId} requested full state for game ${gameId}`);
                session.server.broadcastState(socket.id);
            }
        });

        socket.on('disconnecting', () => {
            // 切断直前に所属していた全ルームを取得
            const rooms = Array.from(socket.rooms);

            socket.on('disconnect', () => {
                // 完全に切断（ルームから退出）した後に、各ルームの人数を更新する
                for (const room of rooms) {
                    const session = sessions.get(room);
                    if (session) {
                        session.server.handleDisconnect(socket.id);
                        updatePresence(room);
                    }
                }
            });
            console.log(`User disconnecting: ${socket.id} (User ID: ${userId})`);
        });

        socket.on('disconnect', () => {
            console.log(`User disconnected: ${socket.id} (User ID: ${userId})`);
        });
    });
};
