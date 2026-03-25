// apps/backend/routes/replays.ts
import { Router } from "express";
import { repo } from "../store/sessionStore";

const router = Router();

// 記録されたゲーム履歴（リプレイ）を取得する
router.get("/:gameId", async (req, res) => {
  const { gameId } = req.params;

  try {
    const record = await repo.loadGameRecord(gameId);
    if (!record) {
      return res.status(404).json({ error: "Replay not found" });
    }

    res.json(record);
  } catch (err: any) {
    console.error(`[Replay API] Error loading record ${gameId}:`, err);
    res.status(500).json({ error: "Failed to load replay" });
  }
});

export default router;
