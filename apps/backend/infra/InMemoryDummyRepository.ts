// apps/backend/infra/InMemoryDummyRepository.ts
import type {
  IGameRepository,
  SessionRecord,
  GameRecordChunk,
} from "@engine/shared/stores/repository";
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
  private deadlines = new Map<string, number>();
  // リプレイ記録（HybridGameRepository と同じ追記の契約。テストで検証できるよう実際に持つ）
  private records = new Map<
    string,
    { record: GameRecord<TState, BaseGameAction>; persistedVersion: number }
  >();

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
    this.deadlines.delete(gameId);
    this.records.delete(gameId);
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

  async scheduleDeadline(gameId: string, at: number): Promise<void> {
    this.deadlines.set(gameId, at);
  }

  async cancelDeadline(gameId: string): Promise<void> {
    this.deadlines.delete(gameId);
  }

  async claimDueDeadlines(now: number): Promise<string[]> {
    const due: string[] = [];
    for (const [gameId, at] of this.deadlines) {
      if (at <= now) due.push(gameId);
    }
    for (const gameId of due) this.deadlines.delete(gameId);
    return due;
  }

  /** テスト用: 予約されている締切（無ければ undefined） */
  getScheduledDeadline(gameId: string): number | undefined {
    return this.deadlines.get(gameId);
  }

  /** テスト用: 予約されている掃除の有無 */
  hasCleanupScheduled(gameId: string): boolean {
    return this.cleanups.has(gameId);
  }

  async close(): Promise<void> {
    // 閉じるべきコネクションはない
  }

  // --- リプレイ記録（プロセス内。セッション削除時に一緒に消す） ---
  async saveGameRecord(gameId: string, record: GameRecord<TState, BaseGameAction>): Promise<void> {
    const copy = JSON.parse(JSON.stringify(record));
    this.records.set(gameId, {
      record: copy,
      persistedVersion: (record.snapshotVersion ?? 0) + record.actions.length,
    });
  }

  async loadGameRecord(gameId: string): Promise<GameRecord<TState, BaseGameAction> | null> {
    const entry = this.records.get(gameId);
    return entry ? JSON.parse(JSON.stringify(entry.record)) : null;
  }

  async appendGameRecord(
    gameId: string,
    chunk: GameRecordChunk<TState, BaseGameAction>,
  ): Promise<void> {
    let entry = this.records.get(gameId);
    if (!entry) {
      entry = {
        record: {
          gameId,
          initialState: chunk.initialState,
          actions: [],
          serverSeedHash: chunk.serverSeedHash,
          clientSeed: chunk.clientSeed,
          stateHashes: chunk.stateHashes.slice(0, 1),
        },
        persistedVersion: chunk.fromVersion,
      };
      this.records.set(gameId, entry);
    }
    // 記録済みの分は捨てる（HybridGameRepository と同じ）
    const skip = Math.max(entry.persistedVersion - chunk.fromVersion, 0);
    const actions = chunk.actions.slice(skip);
    const aligned = chunk.stateHashes.length === chunk.actions.length + 1;
    const hashes = aligned ? chunk.stateHashes.slice(skip + 1) : [];

    const copy = JSON.parse(JSON.stringify({ actions, hashes }));
    entry.record.actions.push(...copy.actions);
    (entry.record.stateHashes ??= []).push(...copy.hashes);
    if (chunk.finalServerSeed !== undefined) entry.record.finalServerSeed = chunk.finalServerSeed;
    entry.persistedVersion = Math.max(
      entry.persistedVersion,
      chunk.fromVersion + chunk.actions.length,
    );
  }
}
