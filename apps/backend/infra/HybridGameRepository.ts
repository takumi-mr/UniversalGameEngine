// apps/backend/infra/HybridGameRepository.ts
import { MongoClient, Db, type Document } from 'mongodb';
import Redis from 'ioredis';
import type { IGameRepository } from '@engine/shared/stores/repository';

// 保存するドキュメントの型を定義
interface GameDocument<T> extends Document {
    _id: string; // ここで string であることを明示
    state: T;
    finishedAt?: Date;
}

export class HybridGameRepository<TState> implements IGameRepository<TState> {
    private redis: Redis;
    private mongoDb: Db;

    constructor(redisUrl: string, mongoUrl: string) {
        this.redis = new Redis(redisUrl);
        const client = new MongoClient(mongoUrl);
        this.mongoDb = client.db('game_platform');
    }

    private get collection() {
        return this.mongoDb.collection<GameDocument<TState>>('games_archive');
    }

    async save(gameId: string, state: TState, isFinished = false): Promise<void> {
        const serialized = JSON.stringify(state);

        // 1. Redisに保存（高速アクセス用）
        // 対戦中はRedisがマスター。TTL（有効期限）を24時間に設定
        await this.redis.set(`game:${gameId}`, serialized, 'EX', 86400);

        // 2. 対局が終了している、または定期的にMongoDBへ保存（永続化）
        if (isFinished) {
            // this.collection を使うことで _id: string が許容される
            await this.collection.updateOne(
                { _id: gameId },
                { $set: { state, finishedAt: new Date() } },
                { upsert: true }
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
}