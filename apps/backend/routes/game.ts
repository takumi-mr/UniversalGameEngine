import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { JWT_SECRET } from '../config';
import { sessions, repo, SocketGameServer } from '../store/sessionStore';
import { getIoInstance, updatePresence } from '../socket/roomManager';
import { gameRegistry } from '@engine/shared/GameRegistry';
import { UniversalEngine } from '@engine/shared/UniversalEngine';

const router = Router();

// ルームから退出する
router.post('/:gameId/leave', async (req, res) => {
    const gameId = req.params.gameId.toLowerCase();
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'No token' });

    try {
        const token = authHeader.split(' ')[1];
        if (!token) return res.status(401).json({ error: 'No token' });
        const decoded = jwt.verify(token, JWT_SECRET) as { userId: string };
        const userId = decoded.userId;

        const session = sessions.get(gameId);
        if (!session) return res.status(404).json({ error: 'Game not found' });

        const state = session.server.engine.getState();
        if (state.players) {
            let found = false;
            for (const key in state.players) {
                if (state.players[key] === userId) {
                    state.players[key] = null;
                    found = true;
                    break;
                }
            }

            if (found) {
                // 通知メッセージをセット
                state.message = `${userId} has left the game`;

                await repo.save(gameId, state, false);
                session.server.broadcastState();

                // 全員にエラー/通知として送信（フロントエンドのトースト用）
                const io = getIoInstance();
                io.to(gameId).emit('error-message', `${userId} has left the game`);

                updatePresence(gameId);
                return res.json({ success: true });
            }
        }
        res.status(400).json({ error: 'User not in game' });
    } catch {
        res.status(401).json({ error: 'Invalid token' });
    }
});

// --- HTTP Polling Endpoints ---
router.get('/:gameId/state', async (req, res) => {
    const gameId = req.params.gameId;
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'No token' });

    try {
        const token = authHeader.split(' ')[1];
        if (!token) return res.status(401).json({ error: 'No token' });
        const decoded = jwt.verify(token, JWT_SECRET) as any;
        const userId = decoded.userId as string;

        let session = sessions.get(gameId.toLowerCase());
        if (!session) {
            const savedData = await repo.load(gameId);
            if (savedData) {
                const def = gameRegistry.getDefinition(savedData.type);
                if (def) {
                    const engine = new UniversalEngine(def.ruleset, {});
                    engine.loadState(savedData.state);
                    const io = getIoInstance();
                    const server = new SocketGameServer(gameId, engine, io);
                    sessions.set(gameId, { server, type: savedData.type });
                    session = sessions.get(gameId);
                }
            } else {
                return res.status(404).json({ error: 'Game not found' });
            }
        }

        const state = session!.server.getPollingState(userId);
        res.json({ state });
    } catch {
        res.status(401).json({ error: 'Invalid token computation' });
    }
});

router.post('/:gameId/action', async (req, res) => {
    const gameId = req.params.gameId;
    const action = req.body;
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'No token' });

    try {
        const token = authHeader.split(' ')[1];
        if (!token) return res.status(401).json({ error: 'No token' });
        const decoded = jwt.verify(token, JWT_SECRET) as any;
        const userId = decoded.userId as string;

        const session = sessions.get(gameId);
        if (!session) return res.status(404).json({ error: 'Game not found' });

        const success = session.server.handleAction(userId, action);
        if (success) {
            const state = session.server.engine.getState();
            await repo.save(gameId, state, state.status === 'FINISHED');
            res.json({ success: true, state: session.server.getPollingState(userId) });
        } else {
            res.status(400).json({ error: 'Invalid action or not your turn' });
        }
    } catch {
        res.status(401).json({ error: 'Invalid token' });
    }
});

export default router;
