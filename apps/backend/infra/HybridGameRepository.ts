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

    /**
     * ゲームタイプと状態をまとめて保存する（ステートレス復元用）。
     * Redis: game:session:{gameId} に { type, state } を保存する。
     */
    async saveSession(gameId: string, type: string, state: TState, isFinished = false): Promise<void> {
        const payload = JSON.stringify({ type, state });
        await this.redis.set(`game:session:${gameId}`, payload, 'EX', 86400);

        if (isFinished) {
            await this.collection.updateOne(
                { _id: gameId },
                { $set: { state, finishedAt: new Date() } as any },
                { upsert: true }
            );
        }
    }

    /**
     * saveSession で保存したセッション（type + state）を復元する。
     * Redis → MongoDB の順で検索する。
     */
    async loadSession(gameId: string): Promise<{ type: string; state: TState } | null> {
        const cached = await this.redis.get(`game:session:${gameId}`);
        if (cached) return JSON.parse(cached);

        // Redis になければ MongoDB のアーカイブから探す（state のみ保存されているため type は不明）
        const archived = await this.collection.findOne({ _id: gameId });
        return archived ? { type: (archived as any).type ?? '', state: archived.state as TState } : null;
    }

    async deleteSession(gameId: string): Promise<void> {
        await this.redis.del(`game:session:${gameId}`);
        await this.delete(gameId);
    }
}