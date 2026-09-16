import { expect, test, describe } from "bun:test";
import { MahjongRuleset as RealMahjongRuleset } from "../mahjong/MahjongRuleset";
import { withTestRng } from "../../testing/withTestRng";
import { UniversalEngine } from "../../UniversalEngine";

// ルールセットを直接呼ぶテストなので、固定シードの RNG を補う
const MahjongRuleset = withTestRng(RealMahjongRuleset);

describe("MahjongRuleset", () => {
  test("getInitialState should return correct initial state", () => {
    const state = MahjongRuleset.getInitialState({ playerIds: ["p1", "p2", "p3", "p4"] });
    expect(state.status).toBe("WAITING");
    expect(state.phase).toBe("WAITING");
    expect(state.playerIds).toEqual(["p1", "p2", "p3", "p4"]);
  });

  test("START action should initialize the game", () => {
    let state = MahjongRuleset.getInitialState({ playerIds: ["p1", "p2", "p3", "p4"] });
    state.players = { p1: "p1", p2: "p2", p3: "p3", p4: "p4" };

    expect(MahjongRuleset.isValidAction(state, { type: "START", playerId: "p1" })).toBe(true);

    state = MahjongRuleset.reduce(state, { type: "START", playerId: "p1" });

    expect(state.status).toBe("PLAYING");
    expect(state.phase).toBe("PLAYING");
    expect(state.wall.value.length).toBe(136 - 14 - 13 * 4); // Total - DeadWall - (13 * 4 players)
    expect(state.hands["p1"].value.length).toBe(13);
    expect(state.activePlayers).toEqual(["p1"]);
  });

  test("DRAW and DISCARD flow", () => {
    let state = MahjongRuleset.getInitialState({ playerIds: ["p1", "p2", "p3", "p4"] });
    state.players = { p1: "p1", p2: "p2", p3: "p3", p4: "p4" };
    state = MahjongRuleset.reduce(state, { type: "START", playerId: "p1" });

    // DRAW
    expect(MahjongRuleset.isValidAction(state, { type: "DRAW", playerId: "p1" })).toBe(true);
    state = MahjongRuleset.reduce(state, { type: "DRAW", playerId: "p1" });
    expect(state.hands["p1"].value.length).toBe(14);

    // DISCARD
    const tileToDiscard = state.hands["p1"].value[0];
    expect(
      MahjongRuleset.isValidAction(state, { type: "DISCARD", playerId: "p1", tile: tileToDiscard }),
    ).toBe(true);
    state = MahjongRuleset.reduce(state, { type: "DISCARD", playerId: "p1", tile: tileToDiscard });

    expect(state.hands["p1"].value.length).toBe(13);
    expect(state.discards["p1"]).toContain(tileToDiscard);
    expect(state.phase).toBe("INTERRUPTING");
    expect(state.pendingDiscard?.tile).toBe(tileToDiscard);
    expect(state.activePlayers).toEqual(["p2", "p3", "p4"]);
  });

  test("Resolution of INTERRUPTING phase by PASS", () => {
    let state = MahjongRuleset.getInitialState({ playerIds: ["p1", "p2", "p3", "p4"] });
    state.players = { p1: "p1", p2: "p2", p3: "p3", p4: "p4" };
    state = MahjongRuleset.reduce(state, { type: "START", playerId: "p1" });
    state = MahjongRuleset.reduce(state, { type: "DRAW", playerId: "p1" });
    const tileToDiscard = state.hands["p1"].value[0];
    state = MahjongRuleset.reduce(state, { type: "DISCARD", playerId: "p1", tile: tileToDiscard });

    // p2 passes
    state = MahjongRuleset.reduce(state, { type: "PASS", playerId: "p2" });
    expect(state.phase).toBe("INTERRUPTING");
    expect(state.pendingDiscard?.pendingActions.length).toBe(1);

    // p3 passes
    state = MahjongRuleset.reduce(state, { type: "PASS", playerId: "p3" });
    expect(state.phase).toBe("INTERRUPTING");

    // p4 passes -> resolving
    state = MahjongRuleset.reduce(state, { type: "PASS", playerId: "p4" });
    expect(state.phase).toBe("PLAYING");
    expect(state.turnIndex).toBe(1); // p2's turn
    expect(state.activePlayers).toEqual(["p2"]);
    expect(state.pendingDiscard).toBeUndefined();
  });

  test("RON resolution", () => {
    let state = MahjongRuleset.getInitialState({ playerIds: ["p1", "p2", "p3", "p4"] });
    state.players = { p1: "p1", p2: "p2", p3: "p3", p4: "p4" };
    state = MahjongRuleset.reduce(state, { type: "START", playerId: "p1" });

    // Force a hand for p2 that is one-away from winning
    // Hand: 111222333m 444p 5s
    // Win tile: 5s
    state.hands["p2"] = {
      value: ["1m", "1m", "1m", "2m", "2m", "2m", "3m", "3m", "3m", "4p", "4p", "4p", "5s"],
      visibleTo: ["p2"],
      mask: ["?"],
    } as any;

    // p1 discards 5s
    state = MahjongRuleset.reduce(state, { type: "DISCARD", playerId: "p1", tile: "5s" });

    // p2 Rons
    expect(MahjongRuleset.isValidAction(state, { type: "RON", playerId: "p2" })).toBe(true);
    state = MahjongRuleset.reduce(state, { type: "RON", playerId: "p2" });

    // Other players pass
    state = MahjongRuleset.reduce(state, { type: "PASS", playerId: "p3" });
    state = MahjongRuleset.reduce(state, { type: "PASS", playerId: "p4" });

    expect(state.status).toBe("FINISHED");
    expect(state.message).toContain("Player p2 won by RON!");
    expect(state.scores["p2"]).toBeGreaterThan(25000);
    expect(state.scores["p1"]).toBeLessThan(25000);
  });

  test("rejects RON when the hand does not win", () => {
    let state = MahjongRuleset.getInitialState({ playerIds: ["p1", "p2", "p3", "p4"] });
    state.players = { p1: "p1", p2: "p2", p3: "p3", p4: "p4" };
    state = MahjongRuleset.reduce(state, { type: "START", playerId: "p1" });
    state.hands["p2"] = {
      __isSecret: true,
      value: ["1m", "2m", "4m", "5m", "7m", "8m", "1p", "2p", "4p", "5p", "7p", "8p", "1z"],
      visibleTo: ["p2"],
    };

    state = MahjongRuleset.reduce(state, { type: "DISCARD", playerId: "p1", tile: "9s" });

    expect(MahjongRuleset.isValidAction(state, { type: "RON", playerId: "p2" })).toBe(false);
    expect(state.pendingDiscard?.pendingActions).toHaveLength(0);
  });

  test("PON consumes tiles and gives the caller the discard", () => {
    let state = MahjongRuleset.getInitialState({ playerIds: ["p1", "p2", "p3", "p4"] });
    state.players = { p1: "p1", p2: "p2", p3: "p3", p4: "p4" };
    state = MahjongRuleset.reduce(state, { type: "START", playerId: "p1" });
    state.hands["p2"] = {
      __isSecret: true,
      value: ["5s", "5s", "1m", "2m", "3m", "4m", "6m", "7m", "8m", "1p", "2p", "3p", "1z"],
      visibleTo: ["p2"],
    };

    state = MahjongRuleset.reduce(state, { type: "DISCARD", playerId: "p1", tile: "5s" });
    expect(
      MahjongRuleset.isValidAction(state, {
        type: "CALL",
        playerId: "p2",
        meldType: "PON",
        consumed: ["5s", "5s"],
      }),
    ).toBe(true);

    state = MahjongRuleset.reduce(state, {
      type: "CALL",
      playerId: "p2",
      meldType: "PON",
      consumed: ["5s", "5s"],
    });
    state = MahjongRuleset.reduce(state, { type: "PASS", playerId: "p3" });
    state = MahjongRuleset.reduce(state, { type: "PASS", playerId: "p4" });

    expect(state.melds["p2"]).toEqual([{ type: "PON", tile: "5s", consumed: ["5s", "5s"] }]);
    expect(state.hands["p2"].value).not.toContain("5s");
    expect(state.hands["p2"].value).toHaveLength(11);
    expect(state.activePlayers).toEqual(["p2"]);
    expect(
      MahjongRuleset.isValidAction(state, { type: "DISCARD", playerId: "p2", tile: "1m" }),
    ).toBe(true);
  });

  test("only the next player may CHI", () => {
    let state = MahjongRuleset.getInitialState({ playerIds: ["p1", "p2", "p3", "p4"] });
    state.players = { p1: "p1", p2: "p2", p3: "p3", p4: "p4" };
    state = MahjongRuleset.reduce(state, { type: "START", playerId: "p1" });
    state.hands["p2"] = {
      __isSecret: true,
      value: ["2m", "4m", "1m", "5m", "6m", "7m", "8m", "1p", "2p", "3p", "4p", "5p", "1z"],
      visibleTo: ["p2"],
    };
    state.hands["p3"] = {
      __isSecret: true,
      value: ["2m", "4m", "1m", "5m", "6m", "7m", "8m", "1p", "2p", "3p", "4p", "5p", "1z"],
      visibleTo: ["p3"],
    };

    state = MahjongRuleset.reduce(state, { type: "DISCARD", playerId: "p1", tile: "3m" });

    const chi = {
      type: "CALL" as const,
      playerId: "p2",
      meldType: "CHI" as const,
      consumed: ["2m", "4m"],
    };
    expect(MahjongRuleset.isValidAction(state, chi)).toBe(true);
    expect(MahjongRuleset.isValidAction(state, { ...chi, playerId: "p3" })).toBe(false);
  });

  test("timeout passes an unanswered interruption and clears the deadline", () => {
    const engine = new UniversalEngine(MahjongRuleset, {
      serverSeed: "mahjong-timeout-seed",
      clientSeed: "mahjong-timeout-client",
    });
    for (const playerId of ["p1", "p2", "p3", "p4"]) {
      expect(engine.dispatch({ type: "JOIN", playerId } as any)).toBe(true);
    }
    expect(engine.dispatch({ type: "START", playerId: "p1", timestamp: 1_000 })).toBe(true);
    expect(engine.dispatch({ type: "DRAW", playerId: "p1", timestamp: 1_001 })).toBe(true);
    expect(
      engine.dispatch({
        type: "DISCARD",
        playerId: "p1",
        tile: engine.getState().hands["p1"].value[0],
        timestamp: 2_000,
      }),
    ).toBe(true);

    const deadline = engine.getState().turnDeadline;
    expect(deadline).toBe(12_000);
    expect(engine.dispatch({ type: "TIMEOUT", playerId: "p2", timestamp: deadline } as any)).toBe(
      true,
    );
    expect(engine.dispatch({ type: "TIMEOUT", playerId: "p3", timestamp: deadline } as any)).toBe(
      true,
    );
    expect(engine.dispatch({ type: "TIMEOUT", playerId: "p4", timestamp: deadline } as any)).toBe(
      true,
    );

    expect(engine.getState().phase).toBe("PLAYING");
    expect(engine.getState().activePlayers).toEqual(["p2"]);
    expect(engine.getState().turnDeadline).toBeUndefined();
    expect(engine.history.slice(-3).map((action) => action.type as string)).toEqual([
      "TIMEOUT",
      "TIMEOUT",
      "TIMEOUT",
    ]);
  });
});
