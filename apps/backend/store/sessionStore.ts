import { UniversalEngine } from '@engine/shared/UniversalEngine';
import { HybridGameRepository } from '../infra/HybridGameRepository';
import { GenericGameServer } from '@engine/shared/network/GenericGameServer';
import { Server } from 'socket.io';
import { generate, compare } from 'fast-json-patch';
import { calculateStateHash } from '@engine/shared';

export class SocketGameServer extends GenericGameServer<any, any> {
    private io: Server;
    // ソケットごとに最後に送信した「マスク済み状態」を記録する
    private lastSentState: Map<string, any> = new Map();

    constructor(roomId: string, engine: UniversalEngine<any, any>, io: Server) {
        super(roomId, engine);
        this.io = io;
    }

    public override broadcastState(): void {
        const state = this.engine.getState();
        const players = state.players ? (Object.values(state.players).filter(Boolean) as string[]) : [];

        this.io.in(this.roomId).fetchSockets().then(sockets => {
            for (const socket of sockets) {
                const userId = socket.data.userId;
                const targetId = players.includes(userId) ? userId : 'SPECTATOR';
                const maskedState = this.engine.getMaskedState(targetId);
                
                // version と hash を付与
                maskedState.version = state.version;
                maskedState.hash = calculateStateHash(maskedState);

                const socketId = socket.id;
                const previousState = this.lastSentState.get(socketId);

                if (previousState && 
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

                // 初回送信、またはパッチの方が大きい場合はフルデータを送信
                socket.emit('state-update', maskedState);
                this.lastSentState.set(socketId, JSON.parse(JSON.stringify(maskedState)));
            }
        }).catch(err => console.error("Broadcast error:", err));
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
