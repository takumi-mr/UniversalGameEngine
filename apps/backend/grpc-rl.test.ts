// apps/backend/grpc-rl.test.ts
// 強化学習ループ（CreateGame → Reset → Step ... → is_finished）が gRPC 経由で完走することを確認する
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import path from "path";
import type { Server } from "socket.io";
import type { ProtoGrpcType } from "@engine/shared/network/generated/game";
import type { GameServiceClient } from "@engine/shared/network/generated/universal_game_engine/GameService";
import type { CreateGameRequest } from "@engine/shared/network/generated/universal_game_engine/CreateGameRequest";
import type { CreateGameResponse__Output } from "@engine/shared/network/generated/universal_game_engine/CreateGameResponse";
import type { ResetGameRequest } from "@engine/shared/network/generated/universal_game_engine/ResetGameRequest";
import type { ResetGameResponse__Output } from "@engine/shared/network/generated/universal_game_engine/ResetGameResponse";
import type { StepRequest } from "@engine/shared/network/generated/universal_game_engine/StepRequest";
import type { StepResponse__Output } from "@engine/shared/network/generated/universal_game_engine/StepResponse";
import type { SimulateRequest } from "@engine/shared/network/generated/universal_game_engine/SimulateRequest";
import type { SimulateResponse__Output } from "@engine/shared/network/generated/universal_game_engine/SimulateResponse";
import type { BatchSimulateRequest } from "@engine/shared/network/generated/universal_game_engine/BatchSimulateRequest";
import type { BatchSimulateResponse__Output } from "@engine/shared/network/generated/universal_game_engine/BatchSimulateResponse";
import type { WaitForTurnResponse__Output } from "@engine/shared/network/generated/universal_game_engine/WaitForTurnResponse";
import type { SubmitTurnRequest } from "@engine/shared/network/generated/universal_game_engine/SubmitTurnRequest";
import type { CommonResponse__Output } from "@engine/shared/network/generated/universal_game_engine/CommonResponse";
import type { OthelloState } from "@engine/shared/rules/OthelloRuleset";
import type { ShogiState } from "@engine/shared/rules/ShogiRuleset";
import { ShogiRuleset } from "@engine/shared/rules/ShogiRuleset";
import { UniversalEngine } from "@engine/shared/UniversalEngine";
import { SHOGI_OBS_DIM } from "@engine/shared/ai/TensorAdapter/ShogiTensorAdapter";
// Redis/MongoDB へ接続しないよう、モジュール読み込み前に RL_MODE を有効化する
process.env.RL_MODE = "true";
const { startGrpcServer } = await import("@engine/backend/grpc-server");
const { sessions, createSession } = await import("@engine/backend/store/sessionStore");
const { setIoInstance } = await import("@engine/backend/socket/roomManager");

const PROTO_PATH = path.resolve(__dirname, "../../packages/shared/network/game.proto");

// Socket.IO は使わないので最小限のモックを注入する
const mockIo = {
  in: () => ({ fetchSockets: async () => [] }),
  local: { in: () => ({ fetchSockets: async () => [] }) },
  to: () => ({ emit: () => {} }),
} as unknown as Server;

// grpc の ServiceError は Metadata を含むため、expect().rejects でのマッチングは避けて code だけ取り出す
async function grpcErrorCode(p: Promise<unknown>): Promise<number | undefined> {
  try {
    await p;
    return undefined;
  } catch (err) {
    return (err as grpc.ServiceError).code;
  }
}

/** コールバック形式の Unary RPC を Promise にする */
function promisify<TReq, TRes>(
  rpc: (req: TReq, callback: grpc.requestCallback<TRes>) => grpc.ClientUnaryCall,
) {
  return (req: TReq) =>
    new Promise<TRes>((resolve, reject) => {
      rpc(req, (err, res) => (err ? reject(err) : resolve(res!)));
    });
}

describe("gRPC RL loop (Reset/Step)", () => {
  let server: grpc.Server;
  let client: GameServiceClient;
  let createGame: (req: CreateGameRequest) => Promise<CreateGameResponse__Output>;
  let reset: (req: ResetGameRequest) => Promise<ResetGameResponse__Output>;
  let step: (req: StepRequest) => Promise<StepResponse__Output>;
  let simulate: (req: SimulateRequest) => Promise<SimulateResponse__Output>;
  let batchSimulate: (req: BatchSimulateRequest) => Promise<BatchSimulateResponse__Output>;
  let submitTurn: (req: SubmitTurnRequest) => Promise<CommonResponse__Output>;

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
    const proto = grpc.loadPackageDefinition(pkgDef) as unknown as ProtoGrpcType;
    client = new proto.universal_game_engine.GameService(
      `localhost:${started.port}`,
      grpc.credentials.createInsecure(),
    );
    createGame = promisify(client.CreateGame.bind(client));
    reset = promisify(client.Reset.bind(client));
    step = promisify(client.Step.bind(client));
    simulate = promisify(client.Simulate.bind(client));
    batchSimulate = promisify(client.BatchSimulate.bind(client));
    submitTurn = promisify(client.SubmitTurn.bind(client));
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
    const state = sessions.get(gameId)!.server.engine.getState() as OthelloState;
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
    const live = sessions.get(gameId)!.server.engine.getState() as OthelloState;
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
  it("将棋: Reset は 95 要素の観測と 30 の合法手を返し、Step / Simulate で指し進められること", async () => {
    const { gameId } = await createGame({ gameType: "shogi" });
    const res = await reset({ gameId, playerIds: ["sente", "gote"] });
    expect(res.activePlayers).toEqual(["sente"]);
    expect(res.initialStateTensor.length).toBe(SHOGI_OBS_DIM);
    expect(res.initialLegalActionIds.length).toBe(30);
    // 先手の玉は自分視点の (4,8)、後手の玉は (4,0)
    expect(res.initialStateTensor[8 * 9 + 4]).toBe(8);
    expect(res.initialStateTensor[4]).toBe(-8);

    // Step: 先手の 1 手目 → 後手視点の観測（盤面が回転して自分の玉が (4,8) に見える）
    const first = res.initialLegalActionIds[0];
    const stepped = await step({ gameId, playerId: "sente", actionId: first });
    expect(stepped.isFinished).toBe(false);
    expect(stepped.activePlayers).toEqual(["gote"]);
    expect(stepped.nextStateTensor[8 * 9 + 4]).toBe(8);
    expect(stepped.legalActionIds.length).toBeGreaterThan(0);
    const state = JSON.parse(stepped.stateJson) as ShogiState;
    expect(state.turn).toBe(-1);

    // Simulate: Step と同じ手を初期局面に適用すると同じ局面になる
    const sim = await simulate({
      gameType: "shogi",
      stateJson: res.stateJson,
      playerId: "sente",
      actionId: first,
    });
    expect(sim.error).toBe("");
    expect((JSON.parse(sim.stateJson) as ShogiState).board).toEqual(state.board);
    expect(sim.stateTensor).toEqual(stepped.nextStateTensor);
  });

  it("将棋: 詰ませる手を Simulate / Step すると is_finished と報酬 1 が返ること", async () => {
    // 先手: 玉 5九、銀 5三、持ち駒 金 / 後手: 玉 5一。5二に金を打てば頭金で詰み
    const I = (x: number, y: number) => y * 9 + x;
    const { gameId } = await createGame({ gameType: "shogi" });
    const res = await reset({ gameId, playerIds: ["sente", "gote"] });
    const state = JSON.parse(res.stateJson) as ShogiState;
    state.board = new Array(81).fill(0);
    state.board[I(4, 0)] = -8;
    state.board[I(4, 2)] = 4;
    state.board[I(4, 8)] = 8;
    state.hands = { 1: { 5: 1 }, "-1": {} };
    state.positionHistory = [];
    // 金打ち 5二: 移動先 (4,1) × 27 + (20 + 金の持ち駒スロット 4)
    const mate = I(4, 1) * 27 + 24;

    const sim = await simulate({
      gameType: "shogi",
      stateJson: JSON.stringify(state),
      playerId: "sente",
      actionId: mate,
    });
    expect(sim.error).toBe("");
    expect(sim.isFinished).toBe(true);
    expect(sim.reward).toBe(1);
    expect(sim.legalActionIds).toEqual([]);
    expect((JSON.parse(sim.stateJson) as ShogiState).status).toBe("FINISHED");

    // Step も同じ（セッションの局面を差し替えてから指す）
    sessions.get(gameId)!.server.engine.loadState(state);
    const stepped = await step({ gameId, playerId: "sente", actionId: mate });
    expect(stepped.isFinished).toBe(true);
    expect(stepped.reward).toBe(1);
    expect(stepped.legalActionIds).toEqual([]);
  });

  it("将棋: gRPC ボットは WaitForTurn 接続時に手番を受け取り、SubmitTurn で指せること", async () => {
    // 人間（後手）+ gRPC ボット（先手）の対局をサーバー内で組み立てる（request-create-game と同じ手順）
    const gameId = "shogi_bot_room";
    const engine = new UniversalEngine(ShogiRuleset, {});
    const { server: gameServer } = createSession(gameId, engine, "shogi");
    engine.dispatch({ type: "JOIN", playerId: "bot_1", slot: "1" });
    gameServer.addBot({ playerId: "bot_1", aiType: "grpc_bot", name: "grpc_bot 1" });
    engine.dispatch({ type: "JOIN", playerId: "human", slot: "-1" });
    engine.dispatch({ type: "START", playerId: "human", timestamp: Date.now() });
    // commit で GrpcBotPlayer.computeNextMove が呼ばれ、ボットの手番が（まだ誰も聞いていない状態で）通知される
    await gameServer.commit();
    expect(engine.getState().activePlayers).toEqual(["bot_1"]);

    // ボットが後から接続しても、現在の手番が改めて届く
    const stream = client.WaitForTurn({ gameId, playerId: "bot_1" });
    // 最後に cancel() するとクライアント側で CANCELLED が error として流れるので握りつぶす
    stream.on("error", () => {});
    const turns: WaitForTurnResponse__Output[] = [];
    const nextTurn = () =>
      new Promise<WaitForTurnResponse__Output>((resolve) => {
        stream.once("data", (t: WaitForTurnResponse__Output) => {
          turns.push(t);
          resolve(t);
        });
      });
    const turn1 = await nextTurn();
    expect(turn1.stateTensor.length).toBe(SHOGI_OBS_DIM);
    expect(turn1.legalActionIds.length).toBe(30);
    expect((JSON.parse(turn1.stateJson) as ShogiState).turn).toBe(1);

    // ボットの着手 → 人間の手番になる
    const submitted = await submitTurn({
      gameId,
      playerId: "bot_1",
      actionId: turn1.legalActionIds[0],
    });
    expect(submitted.success).toBe(true);
    // dispatchAction は非同期（ロック → 保存）なので、状態が進むまで待つ
    for (let i = 0; i < 50 && engine.getState().turn !== -1; i++) {
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(engine.getState().turn).toBe(-1);
    expect(engine.getState().activePlayers).toEqual(["human"]);

    // 人間が指すと、ボットへ次の手番が届く
    const pending = nextTurn();
    const humanMove = ShogiRuleset.getLegalActions(engine.getState() as ShogiState, "human")[0];
    expect(await gameServer.dispatchAction("human", humanMove)).toBe(true);
    const turn2 = await pending;
    expect((JSON.parse(turn2.stateJson) as ShogiState).turn).toBe(1);
    expect(turn2.legalActionIds.length).toBeGreaterThan(0);

    expect(turns.length).toBe(2);
    stream.cancel();
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
