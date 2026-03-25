// apps/backend/infra/HybridGameRepository.ts
import { MongoClient, Db, type Document, type UpdateFilter } from "mongodb";
import Redis from "ioredis";
import type { IGameRepository } from "@engine/shared/stores/repository";
import type { GameRecord, BaseGameState, BaseGameAction } from "@engine/shared/GameRules";

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
   * ゲームタイプと状態をまとめて保存する（ステートレス復元用）。
   * Redis: game:session:{gameId} に { type, state } を保存する。
   */
  async saveSession(
    gameId: string,
    type: string,
    state: TState,
    isFinished = false,
  ): Promise<void> {
    const payload = JSON.stringify({ type, state });
    await this.redis.set(`game:session:${gameId}`, payload, "EX", 86400);

    if (isFinished) {
      await this.collection.updateOne(
        { _id: gameId },
        {
          $set: { state, finishedAt: new Date() } as UpdateFilter<GameDocument<TState>>,
        },
        { upsert: true },
      );
    }
  }

  /**
   * saveSession で保存したセッション（type + state）を復元する。
   * Redis → MongoDB の順で検索する。
   */
  async loadSession(gameId: string): Promise<{ type: string; state: TState } | null> {
    const cached = await this.redis.get(`game:session:${gameId}`);
    if (cached) return JSON.parse(cached) as { type: string; state: TState };

    // Redis になければ MongoDB のアーカイブから探す（state のみ保存されているため type は不明）
    const archived = await this.collection.findOne({ _id: gameId });
    if (!archived) return null;

    return {
      type: archived.type ?? "",
      state: archived.state,
    };
  }

  async deleteSession(gameId: string): Promise<void> {
    await this.redis.del(`game:session:${gameId}`);
    await this.delete(gameId);
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
