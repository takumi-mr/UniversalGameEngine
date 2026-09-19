// apps/backend/routes/replays.ts
import { Router } from "express";
import { repo } from "@engine/backend/store/sessionStore";

const router = Router();

// 記録されたゲーム履歴（リプレイ）を取得する。
// 記録は対局中にも REPLAY_FLUSH_SIZE 手ごとに追記されるが、初期状態（配札・サーバーシード）と
// 全アクション（秘密の入札・選択を含む）をそのまま持つので、終局するまでは返さない。
// 終局は finalServerSeed（終局時の追記でだけ開示される）の有無で判定する
router.get("/:gameId", async (req, res) => {
  const { gameId } = req.params;

  try {
    const record = await repo.loadGameRecord(gameId);
    if (!record || record.finalServerSeed === undefined) {
      return res.status(404).json({ error: "Replay not found" });
    }

    res.json(record);
  } catch (err) {
    console.error(`[Replay API] Error loading record ${gameId}:`, err);
    res.status(500).json({ error: "Failed to load replay" });
  }
});

export default router;
