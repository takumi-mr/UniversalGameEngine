// apps/backend/grpc-rl.test.ts
// 強化学習ループ（CreateGame → Reset → Step ... → is_finished）が gRPC 経由で完走することを確認する
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import path from "path";
// Redis/MongoDB へ接続しないよう、モジュール読み込み前に RL_MODE を有効化する
process.env.RL_MODE = "true";
const { startGrpcServer } = await import("./grpc-server");
const { sessions } = await import("./store/sessionStore");
const { setIoInstance } = await import("./socket/roomManager");

const PROTO_PATH = path.resolve(__dirname, "../../packages/shared/network/game.proto");

// Socket.IO は使わないので最小限のモックを注入する
const mockIo = {
  in: () => ({ fetchSockets: async () => [] }),
  to: () => ({ emit: () => {} }),
  sockets: { adapter: { rooms: new Map() } },
} as any;

// grpc の ServiceError は Metadata を含むため、expect().rejects でのマッチングは避けて code だけ取り出す
async function grpcErrorCode(p: Promise<unknown>): Promise<number | undefined> {
  try {
    await p;
    return undefined;
  } catch (err) {
    return (err as grpc.ServiceError).code;
  }
}

function promisify<TReq, TRes>(client: any, method: string) {
  return (req: TReq) =>
    new Promise<TRes>((resolve, reject) => {
      client[method](req, (err: grpc.ServiceError | null, res: TRes) =>
        err ? reject(err) : resolve(res),
      );
    });
}

describe("gRPC RL loop (Reset/Step)", () => {
  let server: grpc.Server;
  let client: any;
  let createGame: (req: any) => Promise<any>;
  let reset: (req: any) => Promise<any>;
  let step: (req: any) => Promise<any>;
  let simulate: (req: any) => Promise<any>;
  let batchSimulate: (req: any) => Promise<any>;

  beforeAll(async () => {
    setIoInstance(mockIo);
    sessions.clear();
    const started = await startGrpcServer(0);
    server = started.server;

    const pkgDef = protoLoader.loadSync(PROTO_PATH, {
      keepCase: false,
      longs: String,
      enums: String,
      defaults: true,
      oneofs: true,
    });
    const proto = grpc.loadPackageDefinition(pkgDef) as any;
    client = new proto.universal_game_engine.GameService(
      `localhost:${started.port}`,
      grpc.credentials.createInsecure(),
    );
    createGame = promisify(client, "CreateGame");
    reset = promisify(client, "Reset");
    step = promisify(client, "Step");
    simulate = promisify(client, "Simulate");
    batchSimulate = promisify(client, "BatchSimulate");
  });

  afterAll(() => {
    client?.close();
    server?.forceShutdown();
  });

  it("Reset は全員を着席させ、初期観測と合法手を返すこと", async () => {
    const { gameId } = await createGame({ gameType: "othello", optionsJson: "{}" });
    const res = await reset({ gameId, playerIds: ["black", "white"] });

    expect(res.activePlayers).toEqual(["black"]);
    expect(res.initialStateTensor.length).toBe(64);
    expect([...res.initialLegalActionIds].sort((a, b) => a - b)).toEqual([19, 26, 37, 44]);

    const state = sessions.get(gameId)!.server.engine.getState();
    expect(state.status).toBe("PLAYING");
    expect(state.players).toEqual({ 1: "black", [-1]: "white" });
  });

  it("playerIds 省略時は player_1, player_2 が自動生成されること", async () => {
    const { gameId } = await createGame({ gameType: "othello" });
    const res = await reset({ gameId });
    expect(res.activePlayers).toEqual(["player_1"]);
  });

  it("テンソルアダプタ未登録のゲームは UNIMPLEMENTED を返すこと", async () => {
    const { gameId } = await createGame({ gameType: "tictactoe" });
    expect(await grpcErrorCode(reset({ gameId }))).toBe(grpc.status.UNIMPLEMENTED);
  });

  it("不正な手は INVALID_ARGUMENT を返すこと", async () => {
    const { gameId } = await createGame({ gameType: "othello" });
    await reset({ gameId });
    // 中央 (3,3)=27 は既に石があるので不正
    expect(await grpcErrorCode(step({ gameId, playerId: "player_1", actionId: 27 }))).toBe(
      grpc.status.INVALID_ARGUMENT,
    );
    // 手番でないプレイヤーも不正
    expect(await grpcErrorCode(step({ gameId, playerId: "player_2", actionId: 19 }))).toBe(
      grpc.status.INVALID_ARGUMENT,
    );
  });

  it("ランダム自己対戦で終局まで Step でき、観測は次の手番視点で返ること", async () => {
    const { gameId } = await createGame({ gameType: "othello" });
    const obs = await reset({ gameId, playerIds: ["A", "B"] });
    let legal: number[] = obs.initialLegalActionIds;
    let active: string[] = obs.activePlayers;
    let finished = false;
    let steps = 0;
    let lastReward = 0;
    let lastMover = "";

    while (!finished) {
      expect(active.length).toBe(1);
      expect(legal.length).toBeGreaterThan(0);
      const mover = active[0]!;
      const actionId = legal[Math.floor(Math.random() * legal.length)]!;
      const res = await step({ gameId, playerId: mover, actionId });

      finished = res.isFinished;
      legal = res.legalActionIds;
      active = res.activePlayers;
      lastReward = res.reward;
      lastMover = mover;
      steps++;

      if (!finished) {
        // 次の手番の視点: 手番プレイヤーには必ず合法手がある（パスは reduce 内で処理済み）
        expect(res.legalActionIds.length).toBeGreaterThan(0);
        // 観測は自分視点なので、合法手の位置は必ず空マス
        for (const id of res.legalActionIds) expect(res.nextStateTensor[id]).toBe(0);
      }
      expect(steps).toBeLessThan(70);
    }

    expect(legal).toEqual([]);
    expect([1, -1, 0.5]).toContain(lastReward);
    const state = sessions.get(gameId)!.server.engine.getState() as any;
    expect(state.status).toBe("FINISHED");
    // 最終報酬が最終手番プレイヤーの勝敗と一致すること
    const { 1: b, [-1]: w } = state.scores;
    const moverColor = state.players[1] === lastMover ? 1 : -1;
    const moverScore = moverColor === 1 ? b : w;
    const oppScore = moverColor === 1 ? w : b;
    const expected = moverScore > oppScore ? 1 : moverScore < oppScore ? -1 : 0.5;
    expect(lastReward).toBe(expected);
  });

  it("Reset を繰り返しても同じセッションで再学習できること", async () => {
    const { gameId } = await createGame({ gameType: "othello" });
    const first = await reset({ gameId });
    await step({ gameId, playerId: "player_1", actionId: first.initialLegalActionIds[0] });
    const second = await reset({ gameId });
    expect(second.initialStateTensor).toEqual(first.initialStateTensor);
    expect(second.activePlayers).toEqual(["player_1"]);
  });
  it("Reset / Step は state_json を返し、Simulate の親局面として使えること", async () => {
    const { gameId } = await createGame({ gameType: "othello" });
    const root = await reset({ gameId, playerIds: ["A", "B"] });
    expect(root.stateJson.length).toBeGreaterThan(0);
    expect(JSON.parse(root.stateJson).status).toBe("PLAYING");

    const res = await simulate({
      gameType: "othello",
      stateJson: root.stateJson,
      playerId: "A",
      actionId: 19,
    });
    expect(res.error).toBe("");
    expect(res.isFinished).toBe(false);
    expect(res.activePlayers).toEqual(["B"]);
    expect(res.legalActionIds.length).toBeGreaterThan(0);
    expect(res.stateTensor.length).toBe(64);
    // (3,2) に黒が置かれ、次は白番視点なので -1 に見える
    expect(res.stateTensor[19]).toBe(-1);
    expect(JSON.parse(res.stateJson).board[2][3]).toBe(1);

    // Simulate はセッションの実局面を変更しない
    const live = sessions.get(gameId)!.server.engine.getState() as any;
    expect(live.board[2][3]).toBe(0);
    expect(live.version).toBe(JSON.parse(root.stateJson).version);
  });

  it("Simulate は不正な手・未知のゲームを error フィールドで返すこと", async () => {
    const { gameId } = await createGame({ gameType: "othello" });
    const root = await reset({ gameId, playerIds: ["A", "B"] });

    const bad = await simulate({
      gameType: "othello",
      stateJson: root.stateJson,
      playerId: "A",
      actionId: 27,
    });
    expect(bad.error).toContain("Invalid action");
    const wrongTurn = await simulate({
      gameType: "othello",
      stateJson: root.stateJson,
      playerId: "B",
      actionId: 19,
    });
    expect(wrongTurn.error).toContain("Invalid action");
    const unknown = await simulate({
      gameType: "nope",
      stateJson: root.stateJson,
      playerId: "A",
      actionId: 19,
    });
    expect(unknown.error).toContain("Unknown game type");
    const broken = await simulate({
      gameType: "othello",
      stateJson: "{",
      playerId: "A",
      actionId: 19,
    });
    expect(broken.error).toContain("not valid JSON");
  });

  it("BatchSimulate は全ての合法手を独立に展開し、順序どおり返すこと", async () => {
    const { gameId } = await createGame({ gameType: "othello" });
    const root = await reset({ gameId, playerIds: ["A", "B"] });
    const ids: number[] = [...root.initialLegalActionIds, 27]; // 末尾は不正な手
    const res = await batchSimulate({
      items: ids.map((actionId) => ({
        gameType: "othello",
        stateJson: root.stateJson,
        playerId: "A",
        actionId,
      })),
    });
    expect(res.items.length).toBe(ids.length);
    for (let i = 0; i < ids.length - 1; i++) {
      const item = res.items[i]!;
      expect(item.error).toBe("");
      // 展開先の局面で、指した位置には黒がある
      const board = JSON.parse(item.stateJson).board;
      expect(board[Math.floor(ids[i]! / 8)][ids[i]! % 8]).toBe(1);
    }
    expect(res.items[ids.length - 1]!.error).toContain("Invalid action");
  });

  it("Simulate を連鎖させて終局まで到達でき、Step と同じ報酬規則であること", async () => {
    const { gameId } = await createGame({ gameType: "othello" });
    const root = await reset({ gameId, playerIds: ["A", "B"] });
    let stateJson: string = root.stateJson;
    let legal: number[] = root.initialLegalActionIds;
    let active: string[] = root.activePlayers;
    let finished = false;
    let steps = 0;
    let lastReward = 0;
    while (!finished) {
      const res = await simulate({
        gameType: "othello",
        stateJson,
        playerId: active[0]!,
        actionId: legal[Math.floor(Math.random() * legal.length)]!,
      });
      expect(res.error).toBe("");
      stateJson = res.stateJson;
      legal = res.legalActionIds;
      active = res.activePlayers;
      finished = res.isFinished;
      lastReward = res.reward;
      expect(++steps).toBeLessThan(70);
    }
    expect([1, -1, 0.5]).toContain(lastReward);
    expect(JSON.parse(stateJson).status).toBe("FINISHED");
  });
  it("RL_MODE でなければ Reset / Step / Simulate / BatchSimulate は PERMISSION_DENIED になること", async () => {
    const { gameId } = await createGame({ gameType: "othello" });
    const root = await reset({ gameId });
    process.env.RL_MODE = "false";
    try {
      expect(await grpcErrorCode(reset({ gameId }))).toBe(grpc.status.PERMISSION_DENIED);
      expect(await grpcErrorCode(step({ gameId, playerId: "player_1", actionId: 19 }))).toBe(
        grpc.status.PERMISSION_DENIED,
      );
      expect(
        await grpcErrorCode(
          simulate({
            gameType: "othello",
            stateJson: root.stateJson,
            playerId: "player_1",
            actionId: 19,
          }),
        ),
      ).toBe(grpc.status.PERMISSION_DENIED);
      expect(await grpcErrorCode(batchSimulate({ items: [] }))).toBe(grpc.status.PERMISSION_DENIED);
      // 通常の RPC は影響を受けない
      const created = await createGame({ gameType: "othello" });
      expect(created.gameId).toBeTruthy();
    } finally {
      process.env.RL_MODE = "true";
    }
  });
});
