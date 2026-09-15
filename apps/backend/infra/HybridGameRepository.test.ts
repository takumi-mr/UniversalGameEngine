// apps/backend/infra/HybridGameRepository.test.ts
import { describe, it, expect, mock, beforeEach } from "bun:test";

// --- 1. 外部モジュールのモック設定 ---

// Redisのメソッドのモック
const mockRedisSet = mock();
const mockRedisGet = mock();
const mockRedisDel = mock();
const mockRedisEval = mock();
const mockRedisZadd = mock();
const mockRedisZrem = mock();
const mockRedisHgetall = mock();
const mockRedisHdel = mock();
// multi()/pipeline() はチェーン可能なビルダーを返し、exec() 時に積まれたコマンドを記録する
const mockMultiExec = mock(async (): Promise<unknown[]> => []);
const mockPipelineExec = mock(async (): Promise<unknown[]> => []);
const makeChain = (exec: ReturnType<typeof mock>) => {
  const calls: [string, ...unknown[]][] = [];
  const chain: any = { exec: async () => (((exec as any).calls = calls), exec()) };
  for (const cmd of ["set", "hset", "del", "hdel", "zrem", "exists"]) {
    chain[cmd] = (...args: unknown[]) => (calls.push([cmd, ...args]), chain);
  }
  return chain;
};

mock.module("ioredis", () => ({
  default: class MockRedis {
    set = mockRedisSet;
    get = mockRedisGet;
    del = mockRedisDel;
    eval = mockRedisEval;
    zadd = mockRedisZadd;
    zrem = mockRedisZrem;
    hgetall = mockRedisHgetall;
    hdel = mockRedisHdel;
    multi = () => makeChain(mockMultiExec);
    pipeline = () => makeChain(mockPipelineExec);
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
import type { BaseGameState } from "@engine/shared/GameRules";

// --- 2. テストの記述 ---

describe("HybridGameRepository", () => {
  type GameState = BaseGameState & { score: number; turn: number };
  let repo: HybridGameRepository<GameState>;

  beforeEach(() => {
    // 各テストの前にモックの呼び出し履歴をリセットする
    mockRedisSet.mockClear();
    for (const m of [
      mockRedisEval,
      mockRedisZadd,
      mockRedisZrem,
      mockRedisHgetall,
      mockRedisHdel,
      mockMultiExec,
      mockPipelineExec,
    ])
      m.mockClear();
    mockRedisGet.mockClear();
    mockRedisDel.mockClear();
    mockMongoUpdateOne.mockClear();
    mockMongoFindOne.mockClear();
    mockMongoDeleteOne.mockClear();

    // ダミーのURLでリポジトリを初期化（モックされるため実際には接続されません）
    repo = new HybridGameRepository<GameState>("redis://dummy", "mongodb://dummy");
  });

  describe("save", () => {
    it("isFinishedがfalseの場合, Redisにのみ保存され, MongoDBには保存されないこと", async () => {
      const state: GameState = { status: "PLAYING", score: 100, turn: 5 };
      await repo.save("game-1", state);

      // Redisにはシリアライズされて、24時間(86400秒)の有効期限で保存される
      expect(mockRedisSet).toHaveBeenCalledWith("game:game-1", JSON.stringify(state), "EX", 86400);

      // MongoDBの更新処理は呼ばれていないこと
      expect(mockMongoUpdateOne).not.toHaveBeenCalled();
    });

    it("isFinishedがtrueの場合, RedisとMongoDBの両方に保存されること", async () => {
      const state: GameState = { status: "FINISHED", score: 100, turn: 5 };
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
    it("Redisにキャッシュが存在する場合, MongoDBをクエリせずにキャッシュを返すこと", async () => {
      const state: GameState = { status: "PLAYING", score: 200, turn: 10 };
      mockRedisGet.mockResolvedValueOnce(JSON.stringify(state));

      const result = await repo.load("game-2");

      expect(result).toEqual(state);
      expect(mockRedisGet).toHaveBeenCalledWith("game:game-2");
      expect(mockMongoFindOne).not.toHaveBeenCalled(); // MongoDBは呼ばれない
    });

    it("Redisにキャッシュがない場合, MongoDBからデータを取得して返すこと", async () => {
      const state: GameState = { status: "PLAYING", score: 300, turn: 15 };
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

  describe("appendGameRecord", () => {
    it("最初の保存時に $setOnInsert で初期情報をセットし, $push でアクションを追記すること", async () => {
      const record = {
        gameId: "game-123",
        initialState: { status: "PLAYING", score: 0 } as any,
        actions: [{ type: "INCREMENT" }] as any,
        stateHashes: ["hash0", "hash1"],
        snapshotState: { status: "PLAYING", score: 1 } as any,
        snapshotVersion: 1,
      };

      await repo.appendGameRecord("game-123", record);

      expect(mockMongoUpdateOne).toHaveBeenCalledWith(
        { _id: "game-123" },
        {
          $set: {
            "record.snapshotState": record.snapshotState,
            "record.snapshotVersion": 1,
            // "record.finalServerSeed" は undefined なので omitted
            createdAt: expect.any(Date),
          },
          $push: {
            "record.actions": { $each: record.actions },
            "record.stateHashes": { $each: record.stateHashes.slice(1) },
          },
          $setOnInsert: {
            "record.initialState": record.initialState,
            "record.gameId": "game-123",
            // serverSeedHash, clientSeed は undefined なので omitted
            "record.stateHashes": [record.stateHashes[0]],
          },
        },
        { upsert: true },
      );
    });
  });

  describe("saveSession / loadSession", () => {
    it("セッション本体と一覧インデックスを 1 つの MULTI で書き込むこと", async () => {
      const state: GameState = { status: "PLAYING", score: 1, turn: 1 };
      await repo.saveSession("g1", { type: "othello", state, bots: [] });

      const calls = (mockMultiExec as any).calls as [string, ...unknown[]][];
      expect(calls[0]).toEqual([
        "set",
        "game:session:g1",
        JSON.stringify({ type: "othello", state, bots: [] }),
        "EX",
        86400,
      ]);
      expect(calls[1]).toEqual(["hset", "game:sessions", "g1", "othello"]);
      expect(mockMongoUpdateOne).not.toHaveBeenCalled();
    });

    it("終局時は MongoDB にも type 付きで保存すること", async () => {
      const state: GameState = { status: "FINISHED", score: 1, turn: 9 };
      await repo.saveSession("g1", { type: "othello", state }, true);
      expect(mockMongoUpdateOne).toHaveBeenCalledWith(
        { _id: "g1" },
        { $set: expect.objectContaining({ state, type: "othello" }) },
        { upsert: true },
      );
    });

    it("loadSession は Redis のレコードをそのまま返すこと", async () => {
      const record = {
        type: "othello",
        state: { status: "PLAYING", score: 0, turn: 0 } as GameState,
        bots: [],
      };
      mockRedisGet.mockResolvedValueOnce(JSON.stringify(record));
      expect(await repo.loadSession("g1")).toEqual(record);
    });
  });

  describe("listSessions", () => {
    it("本体が消えているインデックスは除外し、インデックスからも削除すること", async () => {
      mockRedisHgetall.mockResolvedValueOnce({ alive: "othello", gone: "chess" });
      mockPipelineExec.mockResolvedValueOnce([
        [null, 1],
        [null, 0],
      ]);

      const result = await repo.listSessions();
      expect(result).toEqual([{ gameId: "alive", type: "othello" }]);
      expect(mockRedisHdel).toHaveBeenCalledWith("game:sessions", "gone");
    });
  });

  describe("withSessionLock", () => {
    it("SET NX でロックを取り、fn の後に自分のトークンでだけ解放すること", async () => {
      mockRedisSet.mockResolvedValueOnce(null).mockResolvedValueOnce("OK"); // 1 回目は取れない
      mockRedisEval.mockResolvedValueOnce(1);

      const result = await repo.withSessionLock("g1", async () => "done");
      expect(result).toBe("done");
      expect(mockRedisSet).toHaveBeenCalledTimes(2);
      const [key, token, px, ttl, nx] = mockRedisSet.mock.calls[1] as unknown[];
      expect([key, px, nx]).toEqual(["game:lock:g1", "PX", "NX"]);
      expect(typeof ttl).toBe("number");
      // 解放スクリプトには同じトークンが渡る
      expect(mockRedisEval.mock.calls[0]?.[2]).toBe("game:lock:g1");
      expect(mockRedisEval.mock.calls[0]?.[3]).toBe(token);
    });

    it("fn が例外を投げてもロックを解放すること", async () => {
      mockRedisSet.mockResolvedValueOnce("OK");
      mockRedisEval.mockResolvedValueOnce(1);
      await expect(
        repo.withSessionLock("g1", async () => {
          throw new Error("boom");
        }),
      ).rejects.toThrow("boom");
      expect(mockRedisEval).toHaveBeenCalledTimes(1);
    });
  });

  describe("cleanup queue", () => {
    it("scheduleCleanup は ZADD NX、cancelCleanup は ZREM を使うこと", async () => {
      await repo.scheduleCleanup("g1", 12345);
      expect(mockRedisZadd).toHaveBeenCalledWith("game:cleanup", "NX", 12345, "g1");
      await repo.cancelCleanup("g1");
      expect(mockRedisZrem).toHaveBeenCalledWith("game:cleanup", "g1");
    });

    it("claimDueCleanups は Lua で取り出した gameId を返すこと", async () => {
      mockRedisEval.mockResolvedValueOnce(["g1", "g2"]);
      expect(await repo.claimDueCleanups(999)).toEqual(["g1", "g2"]);
      expect(mockRedisEval.mock.calls[0]?.slice(1)).toEqual([1, "game:cleanup", 999]);
    });
  });
});
