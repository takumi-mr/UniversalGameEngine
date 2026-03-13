// apps/backend/server.ts
import express from 'express';
import cors from 'cors';
import { Othello3DCore, type MoveAction } from '@engine/shared';

const app = express();
app.use(cors());
app.use(express.json());

// インメモリでゲームセッションを管理
const games = new Map<string, Othello3DCore>();

// 1. 新しいゲームを作成
app.post('/api/games', (req, res) => {
    const size = req.body.size || 4;
    const gameId = Math.random().toString(36).substring(2, 9);
    
    // 共有パッケージのクラスをそのまま使える！
    const newGame = new Othello3DCore(size);
    games.set(gameId, newGame);
    
    res.status(201).json({
        gameId,
        state: newGame.getState()
    });
});

// 2. ゲームの状態を取得
app.get('/api/games/:id', (req, res) => {
    const game = games.get(req.params.id);
    if (!game) {
        res.status(404).json({ error: 'Game not found' });
        return;
    }
    res.json(game.getState());
});

// 3. 駒を置く（アクションの送信）
app.post('/api/games/:id/moves', (req, res) => {
    const game = games.get(req.params.id);
    if (!game) {
        res.status(404).json({ error: 'Game not found' });
        return;
    }

    const action = req.body as MoveAction;

    if (action.x === undefined || action.y === undefined || action.z === undefined || action.color === undefined) {
        res.status(400).json({ error: 'Missing parameters.' });
        return;
    }

    const success = game.dispatchMove(action.x, action.y, action.z, action.color);

    if (success) {
        res.json({ success: true, state: game.getState() });
    } else {
        res.status(400).json({ success: false, error: 'Invalid move or wrong turn.' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Backend running on http://localhost:${PORT}`);
});