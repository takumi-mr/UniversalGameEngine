// apps/backend/infra/InMemoryDummyRepository.ts
import type { IGameRepository, SessionRecord } from "@engine/shared/stores/repository";
import type { GameRecord, BaseGameState, BaseGameAction } from "@engine/shared/GameRules";

/**
 * 強化学習（RL）・単体テスト用のインメモリリポジトリ。
 * 外部DB（Redis/MongoDB）へのアクセスを一切行わず、すべてをプロセス内の Map で処理する。
 * ロックとクリーンアップ予約も HybridGameRepository と同じ契約で実装してあるので、
 * バックエンドのコードはリポジトリの種類を意識しなくてよい。
 */
export class InMemoryDummyRepository<
  TState extends BaseGameState,
> implements IGameRepository<TState> {
  // メモリ内で状態を保持するためのシンプルなMap（必要に応じて）
  private store = new Map<string, TState>();
  private sessionStore = new Map<string, SessionRecord<TState>>();
  // gameId ごとのロック待ち行列（Promise チェーンで直列化）
  private locks = new Map<string, Promise<void>>();
  // gameId → 掃除予定時刻（epoch ms）
  private cleanups = new Map<string, number>();

  async save(gameId: string, state: TState, isFinished = false): Promise<void> {
    this.store.set(gameId, state);
    if (isFinished) {
      this.store.delete(gameId); // 終わったら即破棄してメモリリークを防ぐ
    }
  }

  async load(gameId: string): Promise<TState | null> {
    return this.store.get(gameId) || null;
  }

  async delete(gameId: string): Promise<void> {
    this.store.delete(gameId);
  }

  async saveSession(
    gameId: string,
    record: SessionRecord<TState>,
    isFinished = false,
  ): Promise<void> {
    // 呼び出し側のオブジェクトと共有しないよう、Redis と同じく JSON を経由して保存する
    this.sessionStore.set(gameId, JSON.parse(JSON.stringify(record)));
    if (isFinished) {
      this.sessionStore.delete(gameId);
    }
  }

  async loadSession(gameId: string): Promise<SessionRecord<TState> | null> {
    const record = this.sessionStore.get(gameId);
    return record ? JSON.parse(JSON.stringify(record)) : null;
  }

  async deleteSession(gameId: string): Promise<void> {
    this.sessionStore.delete(gameId);
    this.store.delete(gameId);
    this.cleanups.delete(gameId);
  }

  async listSessions(): Promise<{ gameId: string; type: string }[]> {
    return Array.from(this.sessionStore.entries()).map(([gameId, r]) => ({
      gameId,
      type: r.type,
    }));
  }

  async withSessionLock<T>(gameId: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(gameId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    // 前のロック保持者が終わるまで待ってから実行する（失敗しても次に進めるよう catch する）
    const chained = previous.then(() => current);
    this.locks.set(gameId, chained);
    await previous.catch(() => {});
    try {
      return await fn();
    } finally {
      release();
      if (this.locks.get(gameId) === chained) this.locks.delete(gameId);
    }
  }

  async scheduleCleanup(gameId: string, at: number): Promise<void> {
    if (!this.cleanups.has(gameId)) this.cleanups.set(gameId, at);
  }

  async cancelCleanup(gameId: string): Promise<void> {
    this.cleanups.delete(gameId);
  }

  async claimDueCleanups(now: number): Promise<string[]> {
    const due: string[] = [];
    for (const [gameId, at] of this.cleanups) {
      if (at <= now) due.push(gameId);
    }
    for (const gameId of due) this.cleanups.delete(gameId);
    return due;
  }

  /** テスト用: 予約されている掃除の有無 */
  hasCleanupScheduled(gameId: string): boolean {
    return this.cleanups.has(gameId);
  }

  async close(): Promise<void> {
    // 閉じるべきコネクションはない
  }

  // --- RL学習時はリプレイを保存しないので何もしない ---
  async saveGameRecord(
    _gameId: string,
    _record: GameRecord<TState, BaseGameAction>,
  ): Promise<void> {
    // No-op
  }

  async loadGameRecord(_gameId: string): Promise<GameRecord<TState, BaseGameAction> | null> {
    return null;
  }

  async appendGameRecord(
    _gameId: string,
    _record: Partial<GameRecord<TState, BaseGameAction>>,
  ): Promise<void> {
    // No-op
  }
}
