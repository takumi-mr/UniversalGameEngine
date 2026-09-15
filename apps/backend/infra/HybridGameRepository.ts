// apps/backend/infra/HybridGameRepository.ts
import { MongoClient, Db, type Document, type UpdateFilter } from "mongodb";
import Redis from "ioredis";
import { randomUUID } from "crypto";
import type { IGameRepository, SessionRecord } from "@engine/shared/stores/repository";
import type { GameRecord, BaseGameState, BaseGameAction } from "@engine/shared/GameRules";

// Redis のキー設計
//   game:session:{gameId}  セッション本体（SessionRecord の JSON、TTL 24h）
//   game:sessions          gameId → type の HASH（ルーム一覧用インデックス）
//   game:lock:{gameId}     アクション処理の排他ロック（SET NX PX）
//   game:cleanup           空室クリーンアップ予約の ZSET（score = 実行予定時刻 epoch ms）
const SESSION_TTL_SEC = 86400;
const SESSIONS_INDEX_KEY = "game:sessions";
const CLEANUP_ZSET_KEY = "game:cleanup";
const LOCK_TTL_MS = 5000;
const LOCK_WAIT_MS = 5000;

// ロックの解放は「自分が取ったロックのときだけ削除」する（TTL 切れ後に他人のロックを消さないため）
const RELEASE_LOCK_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
end
return 0`;

// 期限切れの予約を取り出して同時に削除する（複数インスタンスが同じ gameId を拾わないよう原子的に行う）
const CLAIM_CLEANUPS_SCRIPT = `
local due = redis.call("zrangebyscore", KEYS[1], "-inf", ARGV[1], "LIMIT", 0, 100)
for _, id in ipairs(due) do
  redis.call("zrem", KEYS[1], id)
end
return due`;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// 保存するドキュメントの型を定義
interface GameDocument<T> extends Document {
  _id: string;
  state: T;
  type?: string;
  finishedAt?: Date;
}

interface ReplayDocument<TState extends BaseGameState> extends Document {
  _id: string;
  record: GameRecord<TState, BaseGameAction>;
  createdAt: Date;
}

export class HybridGameRepository<TState extends BaseGameState> implements IGameRepository<TState> {
  private redis: Redis;
  private mongoDb: Db;
  private mongoClient: MongoClient;

  constructor(redisUrl: string, mongoUrl: string) {
    this.redis = new Redis(redisUrl);
    this.mongoClient = new MongoClient(mongoUrl);
    this.mongoDb = this.mongoClient.db("game_platform");
  }

  private get collection() {
    return this.mongoDb.collection<GameDocument<TState>>("games_archive");
  }

  private get replayCollection() {
    return this.mongoDb.collection<ReplayDocument<TState>>("game_replays");
  }

  async save(gameId: string, state: TState, isFinished = false): Promise<void> {
    const serialized = JSON.stringify(state);

    // 1. Redisに保存（高速アクセス用）
    // 対戦中はRedisがマスター。TTL（有効期限）を24時間に設定
    await this.redis.set(`game:${gameId}`, serialized, "EX", 86400);

    // 2. 対局が終了している、または定期的にMongoDBへ保存（永続化）
    if (isFinished) {
      // this.collection を使うことで _id: string が許容される
      await this.collection.updateOne(
        { _id: gameId },
        { $set: { state, finishedAt: new Date() } },
        { upsert: true },
      );
    }
  }

  async load(gameId: string): Promise<TState | null> {
    // まずはRedisをチェック
    const cached = await this.redis.get(`game:${gameId}`);
    if (cached) return JSON.parse(cached);

    // RedisになければMongoDB（アーカイブ）から探す
    const archived = await this.collection.findOne({ _id: gameId });
    return archived ? (archived.state as TState) : null;
  }

  async delete(gameId: string): Promise<void> {
    await this.redis.del(`game:${gameId}`);
    await this.collection.deleteOne({ _id: gameId });
  }

  /**
   * セッション（type + state + bots）を保存する（ステートレス復元用）。
   * Redis: game:session:{gameId} に SessionRecord を保存し、一覧用の HASH にも登録する。
   */
  async saveSession(
    gameId: string,
    record: SessionRecord<TState>,
    isFinished = false,
  ): Promise<void> {
    const payload = JSON.stringify(record);
    await this.redis
      .multi()
      .set(`game:session:${gameId}`, payload, "EX", SESSION_TTL_SEC)
      .hset(SESSIONS_INDEX_KEY, gameId, record.type)
      .exec();

    if (isFinished) {
      await this.collection.updateOne(
        { _id: gameId },
        {
          $set: {
            state: record.state,
            type: record.type,
            finishedAt: new Date(),
          } as UpdateFilter<GameDocument<TState>>,
        },
        { upsert: true },
      );
    }
  }

  /**
   * saveSession で保存したセッションを復元する。
   * Redis → MongoDB の順で検索する。
   */
  async loadSession(gameId: string): Promise<SessionRecord<TState> | null> {
    const cached = await this.redis.get(`game:session:${gameId}`);
    if (cached) return JSON.parse(cached) as SessionRecord<TState>;

    // Redis になければ MongoDB のアーカイブから探す（終局済みのものだけがある）
    const archived = await this.collection.findOne({ _id: gameId });
    if (!archived) return null;

    return {
      type: archived.type ?? "",
      state: archived.state,
    };
  }

  async deleteSession(gameId: string): Promise<void> {
    await this.redis
      .multi()
      .del(`game:session:${gameId}`)
      .hdel(SESSIONS_INDEX_KEY, gameId)
      .zrem(CLEANUP_ZSET_KEY, gameId)
      .exec();
    await this.delete(gameId);
  }

  /**
   * 一覧用インデックスから存在するセッションを返す。
   * TTL 切れなどで本体が消えているエントリはここで検出してインデックスからも外す。
   */
  async listSessions(): Promise<{ gameId: string; type: string }[]> {
    const index = await this.redis.hgetall(SESSIONS_INDEX_KEY);
    const ids = Object.keys(index);
    if (ids.length === 0) return [];

    const pipeline = this.redis.pipeline();
    for (const id of ids) pipeline.exists(`game:session:${id}`);
    const results = (await pipeline.exec()) ?? [];

    const alive: { gameId: string; type: string }[] = [];
    const stale: string[] = [];
    ids.forEach((gameId, i) => {
      if (results[i]?.[1] === 1) alive.push({ gameId, type: index[gameId] ?? "" });
      else stale.push(gameId);
    });
    if (stale.length > 0) await this.redis.hdel(SESSIONS_INDEX_KEY, ...stale);
    return alive;
  }

  /**
   * SET NX PX による分散ロック。取得できるまで短い間隔で再試行し、LOCK_WAIT_MS で諦める。
   * ロック TTL は保持側が落ちたときの保険なので、fn は TTL より十分短く終わること。
   */
  async withSessionLock<T>(gameId: string, fn: () => Promise<T>): Promise<T> {
    const key = `game:lock:${gameId}`;
    const token = randomUUID();
    const deadline = Date.now() + LOCK_WAIT_MS;
    while ((await this.redis.set(key, token, "PX", LOCK_TTL_MS, "NX")) !== "OK") {
      if (Date.now() > deadline) {
        throw new Error(`[Redis] Timed out waiting for session lock of game ${gameId}`);
      }
      await sleep(20 + Math.random() * 30);
    }
    try {
      return await fn();
    } finally {
      await this.redis.eval(RELEASE_LOCK_SCRIPT, 1, key, token);
    }
  }

  async scheduleCleanup(gameId: string, at: number): Promise<void> {
    await this.redis.zadd(CLEANUP_ZSET_KEY, "NX", at, gameId);
  }

  async cancelCleanup(gameId: string): Promise<void> {
    await this.redis.zrem(CLEANUP_ZSET_KEY, gameId);
  }

  async claimDueCleanups(now: number): Promise<string[]> {
    const due = (await this.redis.eval(CLAIM_CLEANUPS_SCRIPT, 1, CLEANUP_ZSET_KEY, now)) as
      | string[]
      | null;
    return due ?? [];
  }

  async close(): Promise<void> {
    await this.redis.quit();
    await this.mongoClient.close();
  }

  // --- Game History (Replay) Implementation ---

  async saveGameRecord(gameId: string, record: GameRecord<TState, BaseGameAction>): Promise<void> {
    await this.replayCollection.updateOne(
      { _id: gameId },
      {
        $set: {
          record,
          createdAt: new Date(),
        } as UpdateFilter<ReplayDocument<TState>>,
      },
      { upsert: true },
    );
    console.log(`[Replay] Game record saved for ${gameId}`);
  }

  async loadGameRecord(gameId: string): Promise<GameRecord<TState, BaseGameAction> | null> {
    const doc = await this.replayCollection.findOne({ _id: gameId });
    return doc ? (doc.record as GameRecord<TState, BaseGameAction>) : null;
  }

  /**
   * 既存のゲーム記録にアクションを追加する（スナップショット対応用）。
   * 既に記録がある場合は actions と stateHashes を末尾に追加し、snapshotState を更新する。
   */
  async appendGameRecord(
    gameId: string,
    record: Partial<GameRecord<TState, BaseGameAction>>,
  ): Promise<void> {
    const update: any = {
      $set: {
        ...(record.snapshotState !== undefined && { "record.snapshotState": record.snapshotState }),
        ...(record.snapshotVersion !== undefined && {
          "record.snapshotVersion": record.snapshotVersion,
        }),
        ...(record.finalServerSeed !== undefined && {
          "record.finalServerSeed": record.finalServerSeed,
        }),
        createdAt: new Date(),
      },
    };

    // actions はそのまま $push
    const pushOps: any = {};
    if (record.actions && record.actions.length > 0) {
      pushOps["record.actions"] = { $each: record.actions };
    }

    // stateHashes は 0番目以外を $push (0番目は setOnInsert で入るため)
    if (record.stateHashes && record.stateHashes.length > 1) {
      pushOps["record.stateHashes"] = { $each: record.stateHashes.slice(1) };
    }

    if (Object.keys(pushOps).length > 0) {
      update.$push = pushOps;
    }

    // initialState などの基本情報は初回作成時のみ保存
    const setOnInsert: any = {};
    if (record.initialState) setOnInsert["record.initialState"] = record.initialState;
    if (record.gameId) setOnInsert["record.gameId"] = record.gameId;
    if (record.serverSeedHash) setOnInsert["record.serverSeedHash"] = record.serverSeedHash;
    if (record.clientSeed) setOnInsert["record.clientSeed"] = record.clientSeed;

    // 最初のハッシュも初回作成時のみ保存
    if (record.stateHashes && record.stateHashes.length > 0) {
      setOnInsert["record.stateHashes"] = [record.stateHashes[0]];
    }

    if (Object.keys(setOnInsert).length > 0) {
      update.$setOnInsert = setOnInsert;
    }

    await this.replayCollection.updateOne({ _id: gameId }, update, { upsert: true });
  }
}
