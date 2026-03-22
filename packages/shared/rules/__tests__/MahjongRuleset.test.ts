import { expect, test, describe } from "bun:test";
import { MahjongRuleset } from "../mahjong/MahjongRuleset";

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
});
