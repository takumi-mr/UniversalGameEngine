// apps/backend/rateLimiter.ts
//
// キーごとの簡易レート制限（固定長のスライディングウィンドウ）。
// インスタンスローカルなインメモリ計数なので、複数インスタンス構成では「インスタンス数 × limit」まで通りうる。
// 厳密な上限ではなく、乱造・連打の抑止として使う。
import {
  CREATE_GAME_RATE_LIMIT,
  CREATE_GAME_RATE_WINDOW_MS,
  CREATE_GAME_OPTIONS_MAX_BYTES,
} from "@engine/backend/config";

export class SlidingWindowRateLimiter {
  private readonly limit: number;
  private readonly windowMs: number;
  /** キー → ウィンドウ内の要求時刻（昇順） */
  private readonly hits = new Map<string, number[]>();

  constructor(limit: number, windowMs: number) {
    this.limit = limit;
    this.windowMs = windowMs;
  }

  /**
   * 要求を 1 件計上し、上限内なら true を返す。上限を超えたときは計上しない（拒否された連打で窓が延び続けないように）
   */
  public tryAcquire(key: string, now: number = Date.now()): boolean {
    const since = now - this.windowMs;
    const recent = (this.hits.get(key) ?? []).filter((t) => t > since);
    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(key, recent);
    // 呼ばれなくなったキーは消えないので、増えてきたらまとめて掃除する
    if (this.hits.size > 1024) this.sweep(now);
    return true;
  }

  /** ウィンドウ外の記録しか持たないキーを捨てる */
  public sweep(now: number = Date.now()): void {
    const since = now - this.windowMs;
    for (const [key, times] of this.hits) {
      if (times.every((t) => t <= since)) this.hits.delete(key);
    }
  }

  public clear(): void {
    this.hits.clear();
  }
}

/** 部屋作成のレート制限（ユーザー ID ごと） */
export const createGameLimiter = new SlidingWindowRateLimiter(
  CREATE_GAME_RATE_LIMIT,
  CREATE_GAME_RATE_WINDOW_MS,
);

/**
 * 部屋作成の options のサイズを確かめる。
 * sanitizeCreateOptions は許可リストで絞るが、その前に巨大なペイロードを走査させないためのもの。
 * @param optionsJson options の JSON 文字列（Socket.io なら JSON.stringify 済みのもの、gRPC なら options_json）
 */
export const isCreateOptionsWithinLimit = (optionsJson: string | undefined): boolean =>
  optionsJson === undefined ||
  Buffer.byteLength(optionsJson, "utf8") <= CREATE_GAME_OPTIONS_MAX_BYTES;
