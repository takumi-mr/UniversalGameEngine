import { describe, it, expect } from "bun:test";
import { PredictiveEngine } from "../PredictiveEngine";
import { CyberStrikeRuleset } from "../rules/CyberStrikeRuleset";

describe("PredictiveEngine", () => {
  it("predictAction はローカルエンジンで即座にアクションを実行し、未確認キューに積む", () => {
    const engine = new PredictiveEngine(CyberStrikeRuleset, {});
    // 開始
    engine.localEngine.dispatch({ type: "JOIN", playerId: "alice", slot: "0" } as any);
    engine.localEngine.dispatch({ type: "JOIN", playerId: "bob", slot: "1" } as any);
    engine.localEngine.dispatch({ type: "START", playerId: "alice" });

    const pState = engine.getState();
    expect(pState.status).toBe("PLAYING");

    // 入力予測を実行
    const ok = engine.predictAction({
      type: "INPUT",
      playerId: "alice",
      input: { moveX: 1, moveY: 0 },
    });

    expect(ok).toBe(true);
    expect(engine.metrics.pendingActionsCount).toBe(1);
    expect(engine.getState().playersData["alice"].vx).toBeGreaterThan(0);
  });

  it("isPredictionEnabled = false の場合、ローカル状態は進めず未確認キューにのみ追加する", () => {
    const engine = new PredictiveEngine(CyberStrikeRuleset, {});
    engine.localEngine.dispatch({ type: "JOIN", playerId: "alice", slot: "0" } as any);
    engine.localEngine.dispatch({ type: "JOIN", playerId: "bob", slot: "1" } as any);
    engine.localEngine.dispatch({ type: "START", playerId: "alice" });

    engine.isPredictionEnabled = false;

    const ok = engine.predictAction({
      type: "INPUT",
      playerId: "alice",
      input: { moveX: 1, moveY: 0 },
    });

    // 予測OFF時はローカル適用されない
    expect(ok).toBe(false);
    expect(engine.getState().playersData["alice"].vx).toBe(0);
    expect(engine.metrics.pendingActionsCount).toBe(1);
  });

  it("reconcile は確認済みアクションをパージし、未確認アクションを再シミュレート（ロールバック）する", () => {
    const clientEngine = new PredictiveEngine(CyberStrikeRuleset, {});
    clientEngine.localEngine.dispatch({ type: "JOIN", playerId: "alice", slot: "0" } as any);
    clientEngine.localEngine.dispatch({ type: "JOIN", playerId: "bob", slot: "1" } as any);
    clientEngine.localEngine.dispatch({ type: "START", playerId: "alice" });

    // クライアント側で 3 つのアクションを予測ディスパッチ
    clientEngine.predictAction({
      type: "INPUT",
      playerId: "alice",
      seq: 1,
      input: { moveX: 1, moveY: 0 },
    });
    clientEngine.predictAction({
      type: "TICK",
      seq: 2,
    });
    clientEngine.predictAction({
      type: "INPUT",
      playerId: "alice",
      seq: 3,
      input: { moveX: 0, moveY: 1 },
    });

    expect(clientEngine.metrics.pendingActionsCount).toBe(3);

    // サーバー側で seq 1 まで処理された状態をシミュレート
    const serverEngine = new PredictiveEngine(CyberStrikeRuleset, {});
    serverEngine.localEngine.dispatch({ type: "JOIN", playerId: "alice", slot: "0" } as any);
    serverEngine.localEngine.dispatch({ type: "JOIN", playerId: "bob", slot: "1" } as any);
    serverEngine.localEngine.dispatch({ type: "START", playerId: "alice" });
    serverEngine.localEngine.dispatch({
      type: "INPUT",
      playerId: "alice",
      seq: 1,
      input: { moveX: 1, moveY: 0 },
    });

    const serverState = serverEngine.getState();

    // クライアントがサーバー確定状態 (seq 1 完了) で reconcile
    const result = clientEngine.reconcile(serverState, 1);

    expect(result.rolledBack).toBe(true);
    expect(result.purgedActionsCount).toBe(1); // seq 1 がパージされた
    expect(result.replayedActionsCount).toBe(2); // seq 2, 3 が再シミュレートされた
    expect(clientEngine.metrics.pendingActionsCount).toBe(2);
    expect(clientEngine.metrics.rollbackCount).toBe(1);

    // 最新の入力（seq 3 の moveY: 1）が反映されていること
    const alice = clientEngine.getState().playersData["alice"];
    expect(alice.vy).toBeGreaterThan(0);
  });
});
