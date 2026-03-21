import { UniversalEngine } from '@engine/shared/UniversalEngine';
import { HybridGameRepository } from '../infra/HybridGameRepository';
import { GenericGameServer } from '@engine/shared/network/GenericGameServer';
import { Server } from 'socket.io';
import { generate, compare } from 'fast-json-patch';
import { calculateStateHash } from '@engine/shared';
import { streamManager } from '../network/StreamManager';
import type { IAIPlayer } from '@engine/shared/ai/IAIPlayer';

export class SocketGameServer extends GenericGameServer<any, any> {
    private io: Server;
    // ソケットごとに最後に送信した「マスク済み状態」を記録する
    private lastSentState: Map<string, any> = new Map();
    
    // AIプレイヤーの管理と、思考中の重複呼び出し防止
    public aiPlayers: Map<string, IAIPlayer<any, any>> = new Map();
    private computingAIPlayers: Set<string> = new Set();

    constructor(roomId: string, engine: UniversalEngine<any, any>, io: Server) {
        super(roomId, engine);
        this.io = io;
    }

    public override broadcastState(targetSocketId?: string): void {
        const state = this.engine.getState();
        const players = state.players ? (Object.values(state.players).filter(Boolean) as string[]) : [];
        const isForceFull = !!targetSocketId;

        this.io.in(this.roomId).fetchSockets().then(sockets => {
            for (const socket of sockets) {
                // targetSocketId が指定されている場合はそのソケットのみ処理、そうでなければ全員
                if (targetSocketId && socket.id !== targetSocketId) continue;

                const userId = socket.data.userId;
                const targetId = players.includes(userId) ? userId : 'SPECTATOR';
                const maskedState = this.engine.getMaskedState(targetId);
                
                // version と hash を付与
                maskedState.version = state.version;
                maskedState.hash = calculateStateHash(maskedState);

                const socketId = socket.id;
                const previousState = this.lastSentState.get(socketId);

                // 強制フル更新でない場合、かつ以前の状態がある場合は差分を試みる
                if (!isForceFull && previousState && 
                    previousState.version !== undefined && 
                    previousState.version < maskedState.version) 
                {
                    // 差分（パッチ）を生成
                    const patch = compare(previousState, maskedState);
                    
                    if (patch.length > 0) {
                        const patchPayload = JSON.stringify(patch);
                        const statePayload = JSON.stringify(maskedState);

                        // パッチの方が明らかに小さい場合のみ差分送信
                        if (patchPayload.length < statePayload.length * 0.8) {
                            socket.emit('state-patch', {
                                patch,
                                baseVersion: previousState.version,
                                targetVersion: maskedState.version,
                                hash: maskedState.hash
                            });
                            this.lastSentState.set(socketId, JSON.parse(statePayload));
                            continue;
                        }
                    }
                }

                // 初回送信、パッチの方が大きい場合、または強制フル更新の場合はフルデータを送信
                socket.emit('state-update', maskedState);
                this.lastSentState.set(socketId, JSON.parse(JSON.stringify(maskedState)));
            }
        }).catch(err => console.error("Broadcast error:", err));

        // gRPC ストリームへの通知
        streamManager.notify(this.roomId, (userId) => {
            const targetId = players.includes(userId) ? userId : 'SPECTATOR';
            const maskedState = this.engine.getMaskedState(targetId);
            maskedState.version = state.version;
            maskedState.hash = calculateStateHash(maskedState);

            return {
                stateUpdate: {
                    stateJson: JSON.stringify(maskedState),
                    metadata: {
                        playerCount: players.length,
                        activePlayers: players
                    }
                }
            };
        });

        // AIのターンであれば自動実行する
        this.checkAndExecuteAiTurns();
    }

    private checkAndExecuteAiTurns() {
        const state = this.engine.getState();
        if (state.status !== 'PLAYING') return;

        const activePlayers = state.activePlayers || [];
        for (const playerId of activePlayers) {
            const aiPlayer = this.aiPlayers.get(playerId);
            if (aiPlayer && !this.computingAIPlayers.has(playerId)) {
                this.computingAIPlayers.add(playerId);
                
                const legalActions = this.engine.getLegalActions(playerId);
                aiPlayer.computeNextMove(state, legalActions).then(action => {
                    this.computingAIPlayers.delete(playerId);
                    
                    // ゲームが進行して別プレイヤーのターンになっていないか確認してアクションを実行
                    const currentState = this.engine.getState();
                    if (currentState.status === 'PLAYING' && currentState.activePlayers?.includes(playerId) && action) {
                        this.handleAction(playerId, action);
                    }
                }).catch(err => {
                    this.computingAIPlayers.delete(playerId);
                    console.error(`[AI] Error computing move for player ${playerId}:`, err);
                });
            }
        }
    }

    public handleDisconnect(socketId: string): void {
        this.lastSentState.delete(socketId);
    }
}

export interface GameSession {
    server: SocketGameServer;
    type: string;
}

export const sessions = new Map<string, GameSession>();
export const cleanupTimers = new Map<string, NodeJS.Timeout>();

export const EMPTY_ROOM_TIMEOUT = 5 * 60 * 1000; // 5 minutes

export const repo = new HybridGameRepository<any>(
    process.env.REDIS_URL || 'redis://localhost:6379',
    process.env.MONGO_URL || 'mongodb://localhost:27017'
);
