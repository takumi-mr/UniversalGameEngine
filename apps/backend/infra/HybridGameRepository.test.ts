// apps/backend/infra/HybridGameRepository.test.ts
import { describe, it, expect, mock, beforeEach } from "bun:test";

// --- 1. 外部モジュールのモック設定 ---

// Redisのメソッドのモック
const mockRedisSet = mock();
const mockRedisGet = mock();
const mockRedisDel = mock();

mock.module("ioredis", () => ({
  default: class MockRedis {
    set = mockRedisSet;
    get = mockRedisGet;
    del = mockRedisDel;
  },
}));

// MongoDBのメソッドのモック
const mockMongoUpdateOne = mock();
const mockMongoFindOne = mock();
const mockMongoDeleteOne = mock();

mock.module("mongodb", () => ({
  MongoClient: class MockMongoClient {
    db() {
      return {
        collection: () => ({
          updateOne: mockMongoUpdateOne,
          findOne: mockMongoFindOne,
          deleteOne: mockMongoDeleteOne,
        }),
      };
    }
  },
}));

// ※モックの設定が終わった後にテスト対象をインポートします
import { HybridGameRepository } from "./HybridGameRepository";

// --- 2. テストの記述 ---

describe("HybridGameRepository", () => {
  type GameState = { score: number; turn: number };
  let repo: HybridGameRepository<GameState>;

  beforeEach(() => {
    // 各テストの前にモックの呼び出し履歴をリセットする
    mockRedisSet.mockClear();
    mockRedisGet.mockClear();
    mockRedisDel.mockClear();
    mockMongoUpdateOne.mockClear();
    mockMongoFindOne.mockClear();
    mockMongoDeleteOne.mockClear();

    // ダミーのURLでリポジトリを初期化（モックされるため実際には接続されません）
    repo = new HybridGameRepository<GameState>("redis://dummy", "mongodb://dummy");
  });

  describe("save", () => {
    it("isFinishedがfalseの場合、Redisにのみ保存され、MongoDBには保存されないこと", async () => {
      const state = { score: 100, turn: 5 };
      await repo.save("game-1", state);

      // Redisにはシリアライズされて、24時間(86400秒)の有効期限で保存される
      expect(mockRedisSet).toHaveBeenCalledWith("game:game-1", JSON.stringify(state), "EX", 86400);

      // MongoDBの更新処理は呼ばれていないこと
      expect(mockMongoUpdateOne).not.toHaveBeenCalled();
    });

    it("isFinishedがtrueの場合、RedisとMongoDBの両方に保存されること", async () => {
      const state = { score: 100, turn: 5 };
      await repo.save("game-1", state, true);

      // Redisの呼び出し確認
      expect(mockRedisSet).toHaveBeenCalledWith("game:game-1", JSON.stringify(state), "EX", 86400);

      // MongoDBの呼び出し確認 (Upsert と現在時刻の Date が含まれること)
      expect(mockMongoUpdateOne).toHaveBeenCalledWith(
        { _id: "game-1" },
        { $set: { state, finishedAt: expect.any(Date) } },
        { upsert: true },
      );
    });
  });

  describe("load", () => {
    it("Redisにキャッシュが存在する場合、MongoDBをクエリせずにキャッシュを返すこと", async () => {
      const state = { score: 200, turn: 10 };
      mockRedisGet.mockResolvedValueOnce(JSON.stringify(state));

      const result = await repo.load("game-2");

      expect(result).toEqual(state);
      expect(mockRedisGet).toHaveBeenCalledWith("game:game-2");
      expect(mockMongoFindOne).not.toHaveBeenCalled(); // MongoDBは呼ばれない
    });

    it("Redisにキャッシュがない場合、MongoDBからデータを取得して返すこと", async () => {
      const state = { score: 300, turn: 15 };
      mockRedisGet.mockResolvedValueOnce(null); // Redisは空
      mockMongoFindOne.mockResolvedValueOnce({ _id: "game-3", state }); // MongoDBにはある

      const result = await repo.load("game-3");

      expect(result).toEqual(state);
      expect(mockRedisGet).toHaveBeenCalledWith("game:game-3");
      expect(mockMongoFindOne).toHaveBeenCalledWith({ _id: "game-3" });
    });

    it("RedisにもMongoDBにも存在しない場合、nullを返すこと", async () => {
      mockRedisGet.mockResolvedValueOnce(null);
      mockMongoFindOne.mockResolvedValueOnce(null);

      const result = await repo.load("game-4");

      expect(result).toBeNull();
    });
  });

  describe("delete", () => {
    it("RedisとMongoDBの両方から削除処理を実行すること", async () => {
      await repo.delete("game-5");

      expect(mockRedisDel).toHaveBeenCalledWith("game:game-5");
      expect(mockMongoDeleteOne).toHaveBeenCalledWith({ _id: "game-5" });
    });
  });
});
