// packages/shared/__tests__/builtinActions.test.ts
// エンジン組み込みの JOIN / START が、ルールセットに依存せず着席・開始を行い、
// history に記録されてリプレイで再現できることを検証する。
import { describe, it, expect } from "bun:test";
import { UniversalEngine, type InternalGameState } from "@engine/shared/UniversalEngine";
import { ReplayEngine } from "@engine/shared/ReplayEngine";
import { OthelloRuleset } from "@engine/shared/rules/OthelloRuleset";
import { HighLowRuleset } from "@engine/shared/rules/HighLowRuleset";
import { gameRegistry } from "@engine/shared/GameRegistry";

describe("UniversalEngine builtin JOIN / START", () => {
  it("JOIN は空席に順番に着席させ、重複・満席は拒否すること", () => {
    const engine = new UniversalEngine(OthelloRuleset, {});
    expect(engine.dispatch({ type: "JOIN", playerId: "A" })).toBe(true);
    expect(engine.dispatch({ type: "JOIN", playerId: "A" })).toBe(false); // 既に着席
    expect(engine.dispatch({ type: "JOIN", playerId: "B" })).toBe(true);
    expect(engine.dispatch({ type: "JOIN", playerId: "C" })).toBe(false); // 満席

    const state = engine.getState();
    expect(state.players).toEqual({ 1: "A", [-1]: "B" });
    expect(state.status).toBe("WAITING");
    expect(engine.history.map((a) => a.type as string)).toEqual(["JOIN", "JOIN"]);
    expect(state.version).toBe(2);
  });

  it("JOIN は slot 指定で特定の席に着席でき、埋まっている席は拒否すること", () => {
    const engine = new UniversalEngine(OthelloRuleset, {});
    expect(engine.dispatch({ type: "JOIN", playerId: "white", slot: "-1" })).toBe(true);
    expect(engine.dispatch({ type: "JOIN", playerId: "other", slot: "-1" })).toBe(false);
    expect(engine.dispatch({ type: "JOIN", playerId: "black" })).toBe(true);
    expect(engine.getState().players).toEqual({ 1: "black", [-1]: "white" });
  });

  it("START はルールセットが START を持たないゲームを PLAYING にし、手番を設定すること", () => {
    const engine = new UniversalEngine(OthelloRuleset, {});
    engine.dispatch({ type: "JOIN", playerId: "A" });
    engine.dispatch({ type: "JOIN", playerId: "B" });

    expect(engine.dispatch({ type: "START", playerId: "A" })).toBe(true);
    const state = engine.getState();
    expect(state.status).toBe("PLAYING");
    expect(state.activePlayers).toEqual(["A"]); // 黒番（A）に合法手がある
    expect(engine.getLegalActions("A").length).toBe(4);

    // 開始後の START / JOIN は拒否
    expect(engine.dispatch({ type: "START", playerId: "A" })).toBe(false);
    expect(engine.dispatch({ type: "JOIN", playerId: "C" })).toBe(false);
  });

  it("ルールセット自身が START を扱うゲームでは、ルールセットの reduce が優先されること", () => {
    const engine = new UniversalEngine(HighLowRuleset, {});
    expect(engine.dispatch({ type: "JOIN", playerId: "p1" })).toBe(true);
    expect(engine.dispatch({ type: "START", playerId: "p1" })).toBe(true);
    const state = engine.getState();
    expect(state.status).toBe("PLAYING");
    // HighLow の START は山札を配る（組み込み START だけではこうならない）
    expect(state.baseCard).not.toBeNull();
    expect(state.deck.value.length).toBeGreaterThan(0);
  });

  it("着席・開始を含む対局が GameRecord からハッシュ一致で完全に再現できること", () => {
    const engine = new UniversalEngine(OthelloRuleset, {});
    engine.dispatch({ type: "JOIN", playerId: "A" });
    engine.dispatch({ type: "JOIN", playerId: "B" });
    engine.dispatch({ type: "START", playerId: "A" });
    // 数手進める
    for (let i = 0; i < 6; i++) {
      const pid = engine.getState().activePlayers![0]!;
      const legal = engine.getLegalActions(pid);
      if (legal.length === 0) break;
      expect(engine.dispatch(legal[0]!)).toBe(true);
    }
    const record = engine.getGameRecord("g1");
    expect(record.actions.slice(0, 3).map((a) => a.type as string)).toEqual([
      "JOIN",
      "JOIN",
      "START",
    ]);

    // シードは状態に記録されているので、そこから再現できる
    const replay = new ReplayEngine(OthelloRuleset, {
      ...record,
      finalServerSeed: (engine.getState() as InternalGameState).prngSecret,
    });
    expect(replay.verify(record)).toBe(true);
    expect(replay.getState().board).toEqual(engine.getState().board);
  });

  it("builtin: false では JOIN / START のフォールバック / TIMEOUT を適用しないこと", () => {
    // クライアント由来のアクションはこのモードで dispatch される。
    // ルールセットが受け付けない組み込みアクションで、着席・開始・時間切れを起こせてはならない
    const engine = new UniversalEngine(OthelloRuleset, {});
    expect(engine.dispatch({ type: "JOIN", playerId: "A" }, { builtin: false })).toBe(false);
    expect(engine.getState().players).toEqual({ 1: null, [-1]: null });

    engine.dispatch({ type: "JOIN", playerId: "A" });
    // 1 人しか居ない部屋を開始させられない（Othello は START を持たないのでフォールバックが唯一の経路）
    expect(engine.dispatch({ type: "START", playerId: "A" }, { builtin: false })).toBe(false);
    expect(engine.getState().status).toBe("WAITING");

    engine.dispatch({ type: "JOIN", playerId: "B" });
    engine.dispatch({ type: "START", playerId: "A" });
    expect(engine.getState().status).toBe("PLAYING");

    // 時間切れはサーバーだけが起こせる
    const timedOut = engine.dispatch(
      { type: "TIMEOUT", playerId: "A", timestamp: Number.MAX_SAFE_INTEGER },
      { builtin: false },
    );
    expect(timedOut).toBe(false);
    expect(engine.getState().status).toBe("PLAYING");
    expect(engine.history.map((a) => a.type as string)).toEqual(["JOIN", "JOIN", "START"]);
  });

  it("builtin: false でも、ルールセット自身が START を扱うゲームでは isValidAction に従うこと", () => {
    const engine = new UniversalEngine(HighLowRuleset, {});
    engine.dispatch({ type: "JOIN", playerId: "p1" });
    expect(engine.dispatch({ type: "START", playerId: "p1" }, { builtin: false })).toBe(true);
    expect(engine.getState().status).toBe("PLAYING");
    expect(engine.getState().baseCard).not.toBeNull();
  });

  it("builtin: false では、人数が足りない START をルールセットが拒否したら WAITING のままであること", () => {
    // 麻雀の START は 4 人揃わないと無効。フォールバックで PLAYING にしてしまうと配牌のない壊れた対局になる
    const mahjong = gameRegistry.getDefinition("mahjong")!;
    const engine = new UniversalEngine(mahjong.ruleset, {});
    engine.dispatch({ type: "JOIN", playerId: "p1" });
    expect(engine.dispatch({ type: "START", playerId: "p1" }, { builtin: false })).toBe(false);
    expect(engine.getState().status).toBe("WAITING");
  });

  it("全ゲームで JOIN → START が dispatch を通じて成立すること（players を持つゲーム）", () => {
    for (const def of gameRegistry.getAllDefinitions()) {
      const full = gameRegistry.getDefinition(def.type)!;
      const engine = new UniversalEngine(full.ruleset, {});
      const state = engine.getState();
      if (!state.players) continue;
      const slots = Object.keys(state.players).length;
      const n = Math.min(slots, full.maxPlayers || slots);
      for (let i = 0; i < n; i++) {
        const before = Object.values(engine.getState().players!);
        const pid = `p${i + 1}`;
        // 空席がなければ（options で着席済みのゲーム等）JOIN は失敗してよい
        const expectSeated = before.includes(null) && !before.includes(pid);
        engine.dispatch({ type: "JOIN", playerId: pid });
        const seatedAfter = Object.values(engine.getState().players!).filter(Boolean).length;
        const seatedBefore = before.filter(Boolean).length;
        expect(seatedAfter, `${def.type}: JOIN ${pid}`).toBe(seatedBefore + (expectSeated ? 1 : 0));
      }
      if (engine.getState().status === "WAITING") {
        expect(engine.dispatch({ type: "START", playerId: "p1" }), `${def.type}: START`).toBe(true);
      }
      expect(engine.getState().status, `${def.type}: status after START`).not.toBe("WAITING");
    }
  });
});
