import { Server } from 'socket.io';
import { sessions, cleanupTimers, repo, EMPTY_ROOM_TIMEOUT } from '../store/sessionStore';

let ioInstance: Server | null = null;

export const setIoInstance = (io: Server) => {
    ioInstance = io;
};

export const getIoInstance = (): Server => {
    if (!ioInstance) throw new Error("Socket.IO not initialized");
    return ioInstance;
};

export const scheduleRoomCleanup = (gameId: string) => {
    if (cleanupTimers.has(gameId)) return;
    
    console.log(`[Cleanup] Scheduling cleanup for room ${gameId} in 5 minutes`);
    const timer = setTimeout(async () => {
        console.log(`[Cleanup] Cleaning up room ${gameId}`);
        sessions.delete(gameId);
        cleanupTimers.delete(gameId);
        await repo.delete(gameId);
        const io = getIoInstance();
        io.to(gameId).emit('error-message', 'Room has been deleted due to inactivity.');
    }, EMPTY_ROOM_TIMEOUT);
    
    cleanupTimers.set(gameId, timer);
};

export const clearRoomCleanup = (gameId: string) => {
    if (cleanupTimers.has(gameId)) {
        console.log(`[Cleanup] Cancelling cleanup for room ${gameId}`);
        clearTimeout(cleanupTimers.get(gameId));
        cleanupTimers.delete(gameId);
    }
};

export const updatePresence = (gameId: string) => {
    const io = getIoInstance();
    const room = io.sockets.adapter.rooms.get(gameId);
    const count = room ? room.size : 0;

    // ルーム内の全員に現在の人数などを送信
    io.to(gameId).emit('metadata-update', {
        playerCount: Math.min(count, 2), // 例えば2人までをプレイヤーとする
        spectatorCount: Math.max(0, count - 2),
        activePlayers: Array.from(room || [])
    });

    if (count === 0) {
        scheduleRoomCleanup(gameId);
    } else {
        clearRoomCleanup(gameId);
    }
};
