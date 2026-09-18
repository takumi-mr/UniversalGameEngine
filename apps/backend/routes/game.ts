import { Router } from "express";
import jwt from "jsonwebtoken";
import { JWT_SECRET } from "@engine/backend/config";
import { ensureSession, withSession } from "@engine/backend/store/sessionStore";
import { getIoInstance, updatePresence } from "@engine/backend/socket/roomManager";

const router = Router();

// ルームから退出する
router.post("/:gameId/leave", async (req, res) => {
  const gameId = req.params.gameId.toLowerCase();
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: "No token" });

  let userId: string;
  try {
    const token = authHeader.split(" ")[1];
    if (!token) return res.status(401).json({ error: "No token" });
    const decoded = jwt.verify(token, JWT_SECRET) as { userId: string };
    userId = decoded.userId;
  } catch {
    return res.status(401).json({ error: "Invalid token" });
  }

  // ロックの中でスロットを空け、保存してから通知する
  const result = await withSession(gameId, async (session) => {
    const state = session.server.engine.getState();
    if (!state.players) return false;
    let found = false;
    for (const key in state.players) {
      if (state.players[key] === userId) {
        state.players[key] = null;
        found = true;
        break;
      }
    }
    if (!found) return false;

    // 通知メッセージをセット
    state.message = `${userId} has left the game`;
    await session.server.commit();
    return true;
  });

  if (result === null) return res.status(404).json({ error: "Game not found" });
  if (!result) return res.status(400).json({ error: "User not in game" });

  // 全員にエラー/通知として送信（フロントエンドのトースト用）
  getIoInstance().to(gameId).emit("error-message", `${userId} has left the game`);
  await updatePresence(gameId);
  return res.json({ success: true });
});

// --- HTTP Polling Endpoints ---
router.get("/:gameId/state", async (req, res) => {
  const gameId = req.params.gameId;
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: "No token" });

  let userId: string;
  try {
    const token = authHeader.split(" ")[1];
    if (!token) return res.status(401).json({ error: "No token" });
    const decoded = jwt.verify(token, JWT_SECRET) as { userId: string };
    userId = decoded.userId;
  } catch {
    return res.status(401).json({ error: "Invalid token" });
  }

  // メモリになければストアから復元する（どのインスタンスに当たっても同じ結果になる）
  const session = await ensureSession(gameId);
  if (!session) return res.status(404).json({ error: "Game not found" });

  // ポーリングは別インスタンスの更新を見逃しやすいので、返す前にストアと同期する
  await session.server.refreshFromStore();
  res.json({ state: session.server.getPollingState(userId) });
});

router.post("/:gameId/action", async (req, res) => {
  const gameId = req.params.gameId;
  const action = req.body;
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: "No token" });

  let userId: string;
  try {
    const token = authHeader.split(" ")[1];
    if (!token) return res.status(401).json({ error: "No token" });
    const decoded = jwt.verify(token, JWT_SECRET) as { userId: string };
    userId = decoded.userId;
  } catch {
    return res.status(401).json({ error: "Invalid token" });
  }

  const session = await ensureSession(gameId);
  if (!session) return res.status(404).json({ error: "Game not found" });

  const success = await session.server.dispatchAction(userId, action);
  if (success) {
    res.json({ success: true, state: session.server.getPollingState(userId) });
  } else {
    res.status(400).json({ error: "Invalid action or not your turn" });
  }
});

export default router;
