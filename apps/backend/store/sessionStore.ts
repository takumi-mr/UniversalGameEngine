import { UniversalEngine } from '@engine/shared/UniversalEngine';
import { HybridGameRepository } from '../infra/HybridGameRepository';
import { GenericGameServer } from '@engine/shared/network/GenericGameServer';
import { Server } from 'socket.io';

export class SocketGameServer extends GenericGameServer<any, any> {
    private io: Server;

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
                socket.emit('state-update', maskedState);
            }
        }).catch(err => console.error("Broadcast error:", err));
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
