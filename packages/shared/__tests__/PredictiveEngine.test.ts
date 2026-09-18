// packages/shared/__tests__/PredictiveEngine.test.ts
// クライアント側入力予測: ローカル即時適用 → サーバー確定状態への巻き戻し → 未処理入力の再適用 → 予測時点への進め直し
import { describe, it, expect } from "bun:test";
import { PredictiveEngine } from "@engine/shared/PredictiveEngine";
import { UniversalEngine } from "@engine/shared/UniversalEngine";
import {
  CyberStrikeRuleset,
  TICK_RATE,
  type CyberStrikeAction,
  type CyberStrikeState,
} from "@engine/shared/rules/CyberStrikeRuleset";

const T0 = 1_000_000;
/** ticks 番目のティックに入る時刻（整数 ms。実機の Date.now() と同じく整数で扱う） */
const at = (ticks: number) => T0 + Math.ceil((ticks * 1000) / TICK_RATE);

/** サーバー: 2 人着席で開始済み */
function serverEngine() {
  const engine = new UniversalEngine<CyberStrikeState, CyberStrikeAction>(CyberStrikeRuleset, {
    clientSeed: "c",
    serverSeed: "s",
  });
  engine.dispatch({ type: "JOIN", playerId: "alice" });
  engine.dispatch({ type: "JOIN", playerId: "bob" });
  engine.dispatch({ type: "START", playerId: "alice", timestamp: T0 });
  return engine;
}

/** クライアント: サーバーの初期状態を取り込んだ予測エンジン */
function clientEngine(server: UniversalEngine<CyberStrikeState, CyberStrikeAction>) {
  const client = new PredictiveEngine<CyberStrikeState, CyberStrikeAction>(CyberStrikeRuleset, {});
  client.reconcile(server.getState());
  return client;
}

const input = (seq: number, timestamp: number, moveX: number, moveY = 0): CyberStrikeAction => ({
  type: "INPUT",
  playerId: "alice",
  seq,
  timestamp,
  input: { moveX, moveY },
});
const tickTo = (predicted: CyberStrikeState): CyberStrikeAction => ({
  type: "TICK",
  tick: predicted.tick,
});

describe("PredictiveEngine", () => {
  it("predictAction は即座にローカルへ適用し、未確認キューに積む", () => {
    const server = serverEngine();
    const client = clientEngine(server);
    expect(client.getState().status).toBe("PLAYING");

    expect(client.predictAction(input(1, at(1), 1))).toBe(true);
    expect(client.metrics.pendingActionsCount).toBe(1);
    expect(client.getState().playersData.alice.vx).toBeGreaterThan(0);
  });

  it("予測 OFF ではローカルは進めず、確定状態をそのまま映す", () => {
    const server = serverEngine();
    const client = clientEngine(server);
    client.isPredictionEnabled = false;

    expect(client.predictAction(input(1, at(1), 1))).toBe(false);
    expect(client.getState().playersData.alice.vx).toBe(0);
    expect(client.metrics.pendingActionsCount).toBe(1);
    expect(client.advanceLocal({ type: "TICK", timestamp: T0 + 500 })).toBe(false);
    expect(client.getState().tick).toBe(0);

    server.dispatch(input(1, at(1), 1));
    server.dispatch({ type: "TICK", timestamp: T0 + 500 });
    const r = client.reconcile(server.getState(), 1);
    expect(r.rolledBack).toBe(false);
    expect(client.getState().tick).toBe(server.getState().tick);
    expect(client.metrics.pendingActionsCount).toBe(0);
  });

  it("予測が当たっていれば reconcile で補正は起きず、rollbackCount は増えない", () => {
    const server = serverEngine();
    const client = clientEngine(server);

    // クライアント: 入力 → 時刻駆動でローカルを進める
    client.predictAction(input(1, at(1), 1));
    client.advanceLocal({ type: "TICK", timestamp: at(10) });
    const predicted = client.getState();
    expect(predicted.tick).toBe(10);

    // サーバー: 同じ timestamp で同じ入力を処理（ハートビートでサーバーの方が少し遅れている）
    server.dispatch(input(1, at(1), 1));
    server.dispatch({ type: "TICK", timestamp: at(6) });
    expect(server.getState().tick).toBe(6);

    const r = client.reconcile(server.getState(), 1, { catchUp: tickTo });
    expect(r.purgedActionsCount).toBe(1);
    expect(r.replayedActionsCount).toBe(0);
    expect(r.corrected).toBe(false);
    expect(client.metrics.rollbackCount).toBe(0);
    expect(client.getState().tick).toBe(10);
    expect(client.getState().playersData.alice.x).toBe(predicted.playersData.alice.x);
  });

  it("サーバーが未処理の入力は再適用され、サーバー側の違い（相手の動き）は補正として数える", () => {
    const server = serverEngine();
    const client = clientEngine(server);

    client.predictAction(input(1, at(1), 1));
    client.predictAction(input(2, at(5), 0, 1));
    client.advanceLocal({ type: "TICK", timestamp: at(8) });
    expect(client.metrics.pendingActionsCount).toBe(2);

    // サーバー: seq 1 だけ処理済み。さらに相手（bob）が動いていた
    server.dispatch(input(1, at(1), 1));
    server.dispatch({
      type: "INPUT",
      playerId: "bob",
      timestamp: at(2),
      input: { moveX: -1, moveY: 0 },
    });
    server.dispatch({ type: "TICK", timestamp: at(4) });

    const r = client.reconcile(server.getState(), 1, { catchUp: tickTo });
    expect(r.purgedActionsCount).toBe(1);
    expect(r.replayedActionsCount).toBe(1); // seq 2
    expect(r.corrected).toBe(true); // bob の位置が予測（静止）と違う
    expect(client.metrics.rollbackCount).toBe(1);
    expect(client.metrics.pendingActionsCount).toBe(1);

    const s = client.getState();
    expect(s.tick).toBe(8);
    expect(s.playersData.alice.vy).toBeGreaterThan(0); // seq 2 が効いている
    expect(s.playersData.bob.x).toBeLessThan(800 - 120);
  });

  it("再適用できない未確認アクションは捨てる", () => {
    const server = serverEngine();
    const client = clientEngine(server);
    client.predictAction(input(1, at(1), 1));

    // サーバーでは試合が終わっていた
    const finished = { ...server.getState(), status: "FINISHED" as const };
    const r = client.reconcile(finished, undefined, { catchUp: tickTo });
    expect(r.replayedActionsCount).toBe(0);
    expect(client.metrics.pendingActionsCount).toBe(0);
    expect(client.getState().status).toBe("FINISHED");
  });
});
