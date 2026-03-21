import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { JWT_SECRET } from '../config';
import { sessions } from '../store/sessionStore';
import { getIoInstance } from '../socket/roomManager';

const router = Router();

// アクティブなルーム一覧の取得
router.get('/', (req, res) => {
    const io = getIoInstance();
    const roomList = Array.from(sessions.entries()).map(([id, session]) => ({
        id,
        type: session.type,
        playerCount: io.sockets.adapter.rooms.get(id)?.size ?? 0
    }));
    res.json({ rooms: roomList });
});

// ログインユーザーが参加しているルーム一覧
router.get('/my', (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'No token' });

    try {
        const token = authHeader.split(' ')[1];
        if (!token) return res.status(401).json({ error: 'No token' });
        const decoded = jwt.verify(token, JWT_SECRET) as { userId: string };
        const userId = decoded.userId;
        const io = getIoInstance();
        const myRooms = Array.from(sessions.entries())
            .filter(([_id, session]) => {
                const state = session.server.engine.getState();
                const players = state.players ? Object.values(state.players) : [];
                // Case-insensitive comparison
                return players.some(p => typeof p === 'string' && p.toLowerCase() === userId.toLowerCase());
            })
            .map(([id, session]) => ({
                id,
                type: session.type,
                playerCount: io.sockets.adapter.rooms.get(id)?.size ?? 0
            }));

        res.json({ rooms: myRooms });
    } catch (err) {
        console.error('[/rooms/my] Error:', err);
        res.status(401).json({ error: 'Invalid token' });
    }
});

// ゲーム種別ごとのルーム一覧
router.get('/:gameType', (req, res) => {
    const gameType = req.params.gameType.toLowerCase();
    const io = getIoInstance();
    const roomList = Array.from(sessions.entries())
        .filter(([_, session]) => session.type.toLowerCase() === gameType)
        .map(([id, session]) => ({
            id,
            type: session.type,
            playerCount: io.sockets.adapter.rooms.get(id)?.size ?? 0
        }));
    res.json({ rooms: roomList });
});

export default router;
