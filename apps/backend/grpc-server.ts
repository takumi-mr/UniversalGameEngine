// apps/backend/grpc-server.ts
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import path from 'path';
import jwt from 'jsonwebtoken';
import { JWT_SECRET } from './config';
import { sessions, repo, SocketGameServer } from './store/sessionStore';
import { gameRegistry } from '@engine/shared/GameRegistry';
import { aiTensorRegistry } from '@engine/shared/ai/AITensorAdapterRegistry';
import { UniversalEngine } from '@engine/shared/UniversalEngine';
import type { GameServiceHandlers } from '@engine/shared/network/generated/universal_game_engine/GameService';
import { getIoInstance, scheduleRoomCleanup } from './socket/roomManager';
import { streamManager } from './network/StreamManager';

const PROTO_PATH = path.resolve(__dirname, '../../packages/shared/network/game.proto');

const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
});

const protoDescriptor = grpc.loadPackageDefinition(packageDefinition);
const universal_game_engine = (protoDescriptor as any).universal_game_engine;

const authenticate = (call: grpc.ServerUnaryCall<any, any> | grpc.ServerWritableStream<any, any>): string | null => {
    const metadata = call.metadata.get('authorization');
    if (metadata.length === 0) return 'anonymous'; // モック環境や開発用
    const authHeader = metadata[0] as string;
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;
    try {
        const decoded = jwt.verify(token, JWT_SECRET) as { userId: string };
        return decoded.userId;
    } catch (err) {
        return null;
    }
};

const gameServiceHandlers: GameServiceHandlers = {
    CreateGame: (call, callback) => {
        const userId = authenticate(call);
        if (!userId) return callback({ code: grpc.status.UNAUTHENTICATED, message: 'Invalid token' });

        const { gameType, optionsJson } = call.request;
        const def = gameRegistry.getDefinition(gameType.toLowerCase());
        if (!def) return callback({ code: grpc.status.NOT_FOUND, message: `Unknown game type: ${gameType}` });

        try {
            const gameId = Math.random().toString(36).substring(7);
            const options = JSON.parse(optionsJson || '{}');
            const engine = new UniversalEngine(def.ruleset, options);
            const io = getIoInstance();
            const server = new SocketGameServer(gameId, engine, io);
            sessions.set(gameId, { server, type: gameType.toLowerCase().replace(/-/g, '_') });

            scheduleRoomCleanup(gameId);
            callback(null, { gameId: gameId });
        } catch (err: any) {
            callback({ code: grpc.status.INTERNAL, message: err.message } as any);
        }
    },

    DispatchAction: (call, callback) => {
        const userId = authenticate(call);
        if (!userId) return callback({ code: grpc.status.UNAUTHENTICATED, message: 'Invalid token' });

        const { gameId, action } = call.request;
        const session = sessions.get(gameId);
        if (!session) return callback({ code: grpc.status.NOT_FOUND, message: 'Game session not found' });

        try {
            const payload = action?.payloadJson ? JSON.parse(action.payloadJson) : {};
            const success = session.server.handleAction(userId, { ...payload, type: action?.type });
            if (success) {
                callback(null, { success: true, message: 'Action dispatched' });
            } else {
                callback(null, { success: false, message: 'Invalid action or not your turn' });
            }
        } catch (err: any) {
            callback({ code: grpc.status.INTERNAL, message: err.message } as any);
        }
    },

    SendChat: (call, callback) => {
        const userId = authenticate(call);
        if (!userId) return callback({ code: grpc.status.UNAUTHENTICATED, message: 'Invalid token' });

        const { gameId, message, channel, recipientId } = call.request;
        const chatPayload = {
            userId: userId,
            message: message,
            channel: channel,
            recipientId: recipientId,
            timestamp: new Date().toISOString()
        };

        // 1. gRPCストリームへの通知
        streamManager.broadcast(gameId, {
            chatMessage: chatPayload
        });

        // 2. Socket.IOへの通知
        try {
            const io = getIoInstance();
            if (channel === 'private') {
                io.to(`${gameId}:players`).emit('chat-message', chatPayload);
            } else {
                io.to(gameId).emit('chat-message', chatPayload);
            }
        } catch (err) {
            console.error('[gRPC] Failed to notify Socket.io for chat:', err);
        }

        callback(null, { success: true, message: 'Chat sent' });
    },

    StreamEvents: (call) => {
        const userId = authenticate(call);
        if (!userId) {
            call.destroy({ code: grpc.status.UNAUTHENTICATED, message: 'Invalid token' } as any);
            return;
        }

        const { gameId } = call.request;
        streamManager.addStream(gameId, userId, call);

        // 初回の状態を送信
        const session = sessions.get(gameId);
        if (session) {
            const state = session.server.engine.getState();
            const players = state.players ? (Object.values(state.players).filter(Boolean) as string[]) : [];
            call.write({
                joined: {
                    assignedPlayerId: userId,
                    gameId: gameId
                }
            });
            call.write({
                stateUpdate: {
                    stateJson: JSON.stringify(session.server.engine.getMaskedState(userId)),
                    metadata: {
                        playerCount: players.length,
                        activePlayers: players
                    }
                }
            });
        }

        call.on('cancelled', () => {
            streamManager.removeStream(gameId, call);
        });
    },

    Reset: (call, callback) => {
        const { gameId } = call.request;
        const session = sessions.get(gameId);
        if (!session) return callback({ code: grpc.status.NOT_FOUND, message: 'Game session not found' });

        try {
            const def = gameRegistry.getDefinition(session.type);
            const adapter = aiTensorRegistry.getAdapter(session.type);
            if (!def) return callback({ code: grpc.status.INTERNAL, message: 'Ruleset not found' });
            if (!adapter) return callback({ code: grpc.status.UNIMPLEMENTED, message: 'AI Tensor Adapter not found for this game type' });

            // 1. エンジンの状態をリセットする
            if (typeof (session.server.engine as any).reset === 'function') {
                (session.server.engine as any).reset();
            } else {
                const initialState = def.ruleset.getInitialState(session.server.engine.options);
                session.server.engine.loadState(initialState);
            }

            const state = session.server.engine.getState();
            const activePlayers = state.activePlayers || [];

            // 2. 状態をAI用テンソル（数値配列）に変換
            const perspectivePlayerId = activePlayers.length > 0 ? activePlayers[0] : "";

            const stateTensor = adapter.encodeState(state, perspectivePlayerId);
            const legalActionIds = activePlayers.length > 0
                ? adapter.encodeLegalActions(state, perspectivePlayerId)
                : [];

            callback(null, {
                initialStateTensor: stateTensor,
                initialLegalActionIds: legalActionIds,
                activePlayers: activePlayers
            });
        } catch (err: any) {
            callback({ code: grpc.status.INTERNAL, message: err.message } as any);
        }
    },

    Step: (call, callback) => {
        const { gameId, playerId, actionId } = call.request;
        const session = sessions.get(gameId);
        if (!session) return callback({ code: grpc.status.NOT_FOUND, message: 'Game session not found' });

        try {
            const def = gameRegistry.getDefinition(session.type);
            const adapter = aiTensorRegistry.getAdapter(session.type);
            if (!def) return callback({ code: grpc.status.INTERNAL, message: 'Ruleset not found' });
            if (!adapter) return callback({ code: grpc.status.UNIMPLEMENTED, message: 'AI Tensor Adapter not found for this game type' });

            const state = session.server.engine.getState();

            // 1. 行動インデックス(actionId)を実際のGameActionオブジェクトに復元する
            const action = adapter.decodeAction(state, actionId, playerId);

            // 2. アクションの適用
            const success = session.server.handleAction(playerId, action);
            if (!success) {
                return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'Invalid action or not your turn' });
            }

            // 3. 次の状態と勝敗の確認
            const nextState = session.server.engine.getState();
            const winResult = def.ruleset.checkWinCondition(nextState);
            const isFinished = winResult.isFinished;

            // 4. 報酬の計算（例: 勝ち=1, 負け=-1, 引き分け=0.5）
            let reward = 0;
            if (isFinished) {
                if (winResult.winnerIds?.includes(playerId)) {
                    reward = 1.0;
                } else if (winResult.winnerIds && winResult.winnerIds.length > 0) {
                    reward = -1.0;
                } else {
                    reward = 0.5; // 引き分け
                }
            }

            const activePlayers = nextState.activePlayers || [];

            // 5. 次の状態のテンソルと合法手リストを取得
            const stateTensor = adapter.encodeState(nextState, playerId);
            const legalActionIds = activePlayers.includes(playerId)
                ? adapter.encodeLegalActions(nextState, playerId)
                : [];

            callback(null, {
                nextStateTensor: stateTensor,
                legalActionIds: legalActionIds,
                reward: reward,
                isFinished: isFinished,
                activePlayers: activePlayers
            });

        } catch (err: any) {
            callback({ code: grpc.status.INTERNAL, message: err.message } as any);
        }
    }
};

export const startGrpcServer = (port: number | string) => {
    const server = new grpc.Server();
    server.addService(universal_game_engine.GameService.service, gameServiceHandlers as any);
    server.bindAsync(`0.0.0.0:${port}`, grpc.ServerCredentials.createInsecure(), (err, port) => {
        if (err) {
            console.error(`[gRPC] Failed to bind: ${err.message}`);
            return;
        }
        console.log(`🚀 gRPC Server running on port ${port}`);
    });
};
