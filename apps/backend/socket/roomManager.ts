// apps/backend/socket/roomManager.ts
//
// ルームの在室管理と空室クリーンアップ。
// クリーンアップの予約はプロセス内の setTimeout ではなくリポジトリ（Redis の ZSET / インメモリ）に置き、
// 各インスタンスが定期的に「期限の来た予約」を取り出して掃除する。これにより
//   - 予約したインスタンスが落ちても別のインスタンスが掃除する
//   - 在室判定はクラスタ全体のソケット数で行うので、別インスタンスに人が居る部屋を消さない
import { repo, EMPTY_ROOM_TIMEOUT, destroySession } from "../store/sessionStore";
import { streamManager } from "../network/StreamManager";
import { getIoInstance, setIoInstance, countRoomSockets } from "../network/io";

export { setIoInstance, getIoInstance };

/** 予約を確認する間隔 */
export const CLEANUP_SWEEP_INTERVAL = 15 * 1000;

export const scheduleRoomCleanup = async (gameId: string) => {
  console.log(`[Cleanup] Scheduling cleanup for room ${gameId} in 5 minutes`);
  await repo.scheduleCleanup(gameId, Date.now() + EMPTY_ROOM_TIMEOUT);
};

export const clearRoomCleanup = async (gameId: string) => {
  await repo.cancelCleanup(gameId);
};

/**
 * 期限の来た予約を取り出して掃除する。予約を取り出せるのはクラスタ内の 1 インスタンスだけ。
 * 取り出した時点でまだ誰か居れば（別インスタンスに接続している場合を含む）削除しない。
 */
export const sweepRoomCleanups = async (now = Date.now()): Promise<string[]> => {
  const due = await repo.claimDueCleanups(now);
  const deleted: string[] = [];
  for (const gameId of due) {
    try {
      if ((await countRoomSockets(gameId)) > 0) {
        console.log(`[Cleanup] Room ${gameId} is occupied again — skipped`);
        continue;
      }
      console.log(`[Cleanup] Cleaning up room ${gameId}`);
      await destroySession(gameId);
      getIoInstance().to(gameId).emit("error-message", "Room has been deleted due to inactivity.");
      deleted.push(gameId);
    } catch (err) {
      console.error(`[Cleanup] Failed to clean up room ${gameId}:`, err);
    }
  }
  return deleted;
};

/** 定期掃除を開始する。戻り値で停止できる */
export const startCleanupSweeper = (intervalMs = CLEANUP_SWEEP_INTERVAL) => {
  const timer = setInterval(() => {
    sweepRoomCleanups().catch((err) => console.error("[Cleanup] Sweep failed:", err));
  }, intervalMs);
  // 掃除のためにプロセスを生かし続ける必要はない
  timer.unref?.();
  return () => clearInterval(timer);
};

export const updatePresence = async (gameId: string) => {
  const io = getIoInstance();
  const roomSockets = await io.in(gameId).fetchSockets();
  const count = roomSockets.length;
  const socketIds = roomSockets.map((s) => s.id);

  // ルーム内の全員に現在の人数などを送信
  io.to(gameId).emit("metadata-update", {
    playerCount: Math.min(count, 2), // 例えば2人までをプレイヤーとする
    spectatorCount: Math.max(0, count - 2),
    activePlayers: socketIds,
  });

  // gRPCストリームへの通知
  streamManager.broadcast(gameId, {
    stateUpdate: {
      metadata: {
        playerCount: Math.min(count, 2),
        activePlayers: socketIds,
      },
    },
  });

  if (count === 0) {
    await scheduleRoomCleanup(gameId);
  } else {
    await clearRoomCleanup(gameId);
  }
};
