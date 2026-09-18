// packages/shared/__tests__/timeout.test.ts
// エンジン組み込みの TIMEOUT: 時間切れは「アクション」として状態に入り、リプレイで再現できる。
import { describe, it, expect } from "bun:test";
import { UniversalEngine } from "@engine/shared/UniversalEngine";
import { ReplayEngine } from "@engine/shared/ReplayEngine";
import {
  CaveDiveRuleset,
  type CaveDiveState,
  type CaveDiveAction,
} from "@engine/shared/rules/CaveDiveRuleset";
import { ShogiRuleset } from "@engine/shared/rules/ShogiRuleset";
import { TicTacToeRuleset } from "@engine/shared/rules/TicTacToeRuleset";

const T0 = 1_000_000;

function caveEngine(decisionTimeMs = 10_000) {
  const engine = new UniversalEngine<CaveDiveState, CaveDiveAction>(CaveDiveRuleset, {
    clientSeed: "t",
    serverSeed: "t",
    decisionTimeMs,
  });
  engine.dispatch({ type: "JOIN", playerId: "a" });
  engine.dispatch({ type: "JOIN", playerId: "b" });
  engine.dispatch({ type: "START", playerId: "a", timestamp: T0 });
  return engine;
}

describe("UniversalEngine builtin TIMEOUT", () => {
  it("締切は action.timestamp から計算され、時刻が無い／制限時間 0 なら締切なし", () => {
    const engine = caveEngine();
    expect(engine.getState().turnDeadline).toBe(T0 + 10_000);

    // 分岐点が進めば締切も進む
    engine.dispatch({ type: "CHOOSE", playerId: "a", choice: "STAY", timestamp: T0 + 1000 });
    expect(engine.getState().turnDeadline).toBe(T0 + 10_000); // まだ b 待ち
    engine.dispatch({ type: "CHOOSE", playerId: "b", choice: "STAY", timestamp: T0 + 2000 });
    expect(engine.getState().turnDeadline).toBe(T0 + 12_000);

    const noClock = new UniversalEngine<CaveDiveState, CaveDiveAction>(CaveDiveRuleset, {});
    noClock.dispatch({ type: "JOIN", playerId: "a" });
    noClock.dispatch({ type: "JOIN", playerId: "b" });
    noClock.dispatch({ type: "START", playerId: "a" });
    expect(noClock.getState().turnDeadline).toBeUndefined();
    expect(caveEngine(0).getState().turnDeadline).toBeUndefined();
  });

  it("締切前・手番でない人・締切の無いゲームへの TIMEOUT は無効", () => {
    const engine = caveEngine();
    const deadline = engine.getState().turnDeadline!;
    expect(engine.dispatch({ type: "TIMEOUT", playerId: "a", timestamp: deadline - 1 })).toBe(
      false,
    );
    expect(engine.dispatch({ type: "TIMEOUT", playerId: "a" })).toBe(false); // 時刻なし
    expect(engine.dispatch({ type: "TIMEOUT", playerId: "zed", timestamp: deadline })).toBe(false);
    engine.dispatch({ type: "CHOOSE", playerId: "a", choice: "STAY", timestamp: T0 + 1 });
    // 選択済みの a はもう手番ではない
    expect(engine.dispatch({ type: "TIMEOUT", playerId: "a", timestamp: deadline })).toBe(false);
    expect(engine.getState().activePlayers).toEqual(["b"]);

    const noClock = caveEngine(0);
    expect(noClock.dispatch({ type: "TIMEOUT", playerId: "a", timestamp: T0 + 1 })).toBe(false);
  });

  it("getTimeoutAction があればそれで解決し、履歴には TIMEOUT が残ってリプレイで再現できる", () => {
    const engine = caveEngine();
    const deadline = engine.getState().turnDeadline!;
    engine.dispatch({ type: "CHOOSE", playerId: "a", choice: "STAY", timestamp: T0 + 1 });

    expect(engine.dispatch({ type: "TIMEOUT", playerId: "b", timestamp: deadline })).toBe(true);
    const s = engine.getState();
    // b は LEAVE 扱いで精算され、a だけが洞窟に残って次のカードがめくられた
    expect(s.revealedChoices).toEqual({ a: "STAY", b: "LEAVE" });
    expect(s.inCave).toEqual(["a"]);
    expect(s.turnDeadline).toBe(deadline + 10_000);
    expect(engine.history.map((a) => a.type)).toEqual([
      "JOIN",
      "JOIN",
      "START",
      "CHOOSE",
      "TIMEOUT",
    ]);

    const record = engine.getGameRecord("g");
    const replay = new ReplayEngine(CaveDiveRuleset, {
      ...record,
      finalServerSeed: (s as any).prngSecret,
    });
    expect(replay.verify(record)).toBe(true);
    expect(replay.getState().revealedChoices).toEqual({ a: "STAY", b: "LEAVE" });
  });

  it("getTimeoutAction が無ければ RESIGN として扱う（将棋）", () => {
    const engine = new UniversalEngine(ShogiRuleset, {});
    engine.dispatch({ type: "JOIN", playerId: "sente" } as any);
    engine.dispatch({ type: "JOIN", playerId: "gote" } as any);
    engine.dispatch({ type: "START", playerId: "sente" } as any);
    engine.loadState({ ...engine.getState(), turnDeadline: T0 }, engine.getReplayData());

    expect(engine.dispatch({ type: "TIMEOUT", playerId: "sente", timestamp: T0 } as any)).toBe(
      true,
    );
    const s = engine.getState();
    expect(s.status).toBe("FINISHED");
    expect(s.resignedBy).toBe(1);
    expect(ShogiRuleset.checkWinCondition(s).winnerIds).toEqual(["gote"]);
    expect(engine.history.at(-1)?.type as string).toBe("TIMEOUT");
  });

  it("RESIGN も無ければ手番側の負けとして強制終了する（三目並べ）", () => {
    const engine = new UniversalEngine(TicTacToeRuleset, {});
    engine.dispatch({ type: "JOIN", playerId: "x" } as any);
    engine.dispatch({ type: "JOIN", playerId: "o" } as any);
    engine.dispatch({ type: "START", playerId: "x" } as any);
    engine.loadState({ ...engine.getState(), turnDeadline: T0 }, engine.getReplayData());

    expect(engine.dispatch({ type: "TIMEOUT", playerId: "x", timestamp: T0 + 5 } as any)).toBe(
      true,
    );
    const s = engine.getState();
    expect(s.status).toBe("FINISHED");
    expect(s.message).toContain("timed out");
    expect(s.activePlayers).toEqual([]);
    expect(engine.getLegalActions("o")).toEqual([]);
  });
});
