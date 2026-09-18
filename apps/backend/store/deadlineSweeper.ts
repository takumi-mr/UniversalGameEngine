// apps/backend/store/deadlineSweeper.ts
//
// 手番の締切（state.turnDeadline）を発火させる係。
// エンジンは純粋なステートマシンなので、時間切れも「TIMEOUT アクションが届いた」という形で状態に入る。
//   - 予約はリポジトリ（Redis の ZSET / インメモリ）にあり、commit() のたびに更新される
//   - 各インスタンスが定期的に「期限の来た予約」を取り出し、取り出せた 1 台だけが TIMEOUT を dispatch する
//   - dispatch はロック内で最新状態に対して検証されるので、別インスタンスが先に手を進めていれば単に拒否される
//     （エンジン側で「締切前」「手番でない」TIMEOUT は無効）
import { repo, ensureSession, withSession } from "@engine/backend/store/sessionStore";

/** 予約を確認する間隔 */
export const DEADLINE_SWEEP_INTERVAL = 1000;

/**
 * 期限の来た締切を取り出し、手番のプレイヤー全員分の TIMEOUT を dispatch する。
 * @returns TIMEOUT を実際に適用できた gameId
 */
export const sweepDeadlines = async (now = Date.now()): Promise<string[]> => {
  const due = await repo.claimDueDeadlines(now);
  const fired: string[] = [];

  for (const gameId of due) {
    try {
      // ロック内で最新状態を読み、まだ締切なら対象プレイヤーを確定する
      const snapshot = await withSession(gameId, async (session) => {
        const state = session.server.engine.getState();
        if (state.status !== "PLAYING" || state.turnDeadline === undefined) return null;
        if (state.turnDeadline > now) {
          // 別インスタンスが手を進めて締切が延びていた: 予約を戻す
          await repo.scheduleDeadline(gameId, state.turnDeadline);
          return null;
        }
        return [...(state.activePlayers ?? [])];
      });
      if (!snapshot || snapshot.length === 0) continue;

      // dispatchAction は自分でロックを取る（withSession の中から呼ぶと二重ロックになる）
      const session = await ensureSession(gameId);
      if (!session) continue;
      let applied = false;
      for (const playerId of snapshot) {
        if (await session.server.dispatchAction(playerId, { type: "TIMEOUT" })) applied = true;
      }
      if (applied) {
        console.log(`[Deadline] TIMEOUT applied for game ${gameId} (${snapshot.join(", ")})`);
        fired.push(gameId);
      }

      // どの TIMEOUT も通らなかった（同時に手が進んだ等）場合、次の締切があれば予約し直す
      await withSession(gameId, async (s) => {
        const state = s.server.engine.getState();
        if (state.status === "PLAYING" && state.turnDeadline !== undefined) {
          await repo.scheduleDeadline(gameId, state.turnDeadline);
        }
      });
    } catch (err) {
      console.error(`[Deadline] Failed to process deadline for game ${gameId}:`, err);
    }
  }
  return fired;
};

/** 定期確認を開始する。戻り値で停止できる */
export const startDeadlineSweeper = (intervalMs = DEADLINE_SWEEP_INTERVAL) => {
  const timer = setInterval(() => {
    sweepDeadlines().catch((err) => console.error("[Deadline] Sweep failed:", err));
  }, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
};
