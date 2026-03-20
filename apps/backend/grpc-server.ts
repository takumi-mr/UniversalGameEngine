// apps/backend/grpc-server.ts
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import path from 'path';
import jwt from 'jsonwebtoken';
import { JWT_SECRET } from './config';
import { sessions, repo, SocketGameServer } from './store/sessionStore';
import { gameRegistry } from '@engine/shared/GameRegistry';
import { UniversalEngine } from '@engine/shared/UniversalEngine';
import type { GameServiceHandlers } from '@engine/shared/network/generated/universal_game_engine/GameService';
import { getIoInstance, scheduleRoomCleanup } from './socket/roomManager';

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

// gRPCストリームを保持するためのマップ
const activeStreams = new Map<string, Set<grpc.ServerWritableStream<any, any>>>();

export const notifyGrpcStreams = (gameId: string, event: any) => {
    const streams = activeStreams.get(gameId);
    if (streams) {
        for (const stream of streams) {
            stream.write(event);
        }
    }
};

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
                // Socket.IO側のブロードキャストは handleAction 内で行われるが、gRPCストリームへの通知も行う
                const state = session.server.engine.getState();
                notifyGrpcStreams(gameId, {
                    stateUpdate: {
                        stateJson: JSON.stringify(session.server.engine.getMaskedState(userId)),
                        metadata: {
                            playerCount: Object.keys(state.players || {}).length,
                            activePlayers: Object.values(state.players || {}).filter(Boolean) as string[]
                        }
                    }
                });
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
        // チャットロジックの簡略化実装
        notifyGrpcStreams(gameId, {
            chatMessage: {
                userId: userId,
                message: message,
                channel: channel,
                recipientId: recipientId,
                timestamp: new Date().toISOString()
            }
        });
        callback(null, { success: true, message: 'Chat sent' });
    },

    StreamEvents: (call) => {
        const userId = authenticate(call);
        if (!userId) {
            call.destroy({ code: grpc.status.UNAUTHENTICATED, message: 'Invalid token' } as any);
            return;
        }

        const { gameId } = call.request;
        if (!activeStreams.has(gameId)) {
            activeStreams.set(gameId, new Set());
        }
        const streams = activeStreams.get(gameId)!;
        streams.add(call);

        // 初回の状態を送信
        const session = sessions.get(gameId);
        if (session) {
            const state = session.server.engine.getState();
            call.write({
                joined: {
                    assignedPlayerId: userId, // 実際にはエンジン側での割り当てが必要
                    gameId: gameId
                }
            });
            call.write({
                stateUpdate: {
                    stateJson: JSON.stringify(session.server.engine.getMaskedState(userId))
                }
            });
        }

        call.on('cancelled', () => {
            streams.delete(call);
            if (streams.size === 0) {
                activeStreams.delete(gameId);
            }
        });
    },

    Reset: (call, callback) => {
        const { gameId } = call.request;
        const session = sessions.get(gameId);
        if (!session) return callback({ code: grpc.status.NOT_FOUND, message: 'Game session not found' });

        try {
            const def = gameRegistry.getDefinition(session.type);
            if (!def) return callback({ code: grpc.status.INTERNAL, message: 'Ruleset not found' });

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
            const stateTensor = (def.ruleset as any).encodeState
                ? (def.ruleset as any).encodeState(state)
                : [];

            // 3. 現在手番のプレイヤーの合法手インデックスリストを取得
            let legalActionIds: number[] = [];
            if (activePlayers.length > 0 && (def.ruleset as any).encodeLegalActions) {
                legalActionIds = (def.ruleset as any).encodeLegalActions(state, activePlayers[0]);
            }

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
            const state = session.server.engine.getState();

            // 1. 行動インデックス(actionId)を実際のGameActionオブジェクトに復元する
            if (!def || !(def.ruleset as any).decodeAction) {
                return callback({ code: grpc.status.UNIMPLEMENTED, message: 'decodeAction not implemented in ruleset' });
            }
            const action = (def.ruleset as any).decodeAction(state, actionId, playerId);

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

            // 5. 次の状態のテンソルと合法手リストを取得
            const stateTensor = (def.ruleset as any).encodeState ? (def.ruleset as any).encodeState(nextState) : [];
            const activePlayers = nextState.activePlayers || [];

            let legalActionIds: number[] = [];
            // 次のターンが自分自身（AI）のターンの場合のみ、合法手を計算して返す
            if (activePlayers.includes(playerId) && (def.ruleset as any).encodeLegalActions) {
                legalActionIds = (def.ruleset as any).encodeLegalActions(nextState, playerId);
            }

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
