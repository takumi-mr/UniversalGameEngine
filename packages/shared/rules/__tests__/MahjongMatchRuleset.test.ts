import { describe, expect, test } from "bun:test";
import "../../GameRegistry";
import { MahjongMatchRuleset } from "../mahjong/MahjongMatchRuleset";
import type { MahjongState } from "../mahjong/MahjongRuleset";
import { ProvablyFairRNG } from "../../utils/ProvablyFairRNG";

const players = ["p1", "p2", "p3", "p4"];

describe("MahjongMatchRuleset", () => {
  test("東風戦を1局目の東場として開始する", () => {
    const state = MahjongMatchRuleset.getInitialState(
      { playerIds: players, mode: "TONPU" },
      new ProvablyFairRNG("match-test", "tonpu", 0),
    );

    expect(state.status).toBe("PLAYING");
    expect(state.mode).toBe("TONPU");
    expect(state.currentGameId).toBe("hand-1");
    expect(state.currentGame.type).toBe("mahjong");
    const hand = state.currentGame.state as MahjongState;
    expect(hand.wind).toBe("EAST");
    expect(hand.round).toBe(1);
    expect(state.scores).toEqual({
      p1: 25_000,
      p2: 25_000,
      p3: 25_000,
      p4: 25_000,
    });
    expect(state.activePlayers).toEqual(["p1"]);
  });

  test("半荘戦は南場の局を表現できる", () => {
    const state = MahjongMatchRuleset.getInitialState(
      {
        playerIds: players,
        mode: "HANCHAN",
        initialScores: { p1: 30_000, p2: 25_000, p3: 25_000, p4: 20_000 },
      },
      new ProvablyFairRNG("match-test", "hanchan", 0),
    );

    expect(state.mode).toBe("HANCHAN");
    expect((state.currentGame.state as MahjongState).scores).toEqual({
      p1: 30_000,
      p2: 25_000,
      p3: 25_000,
      p4: 20_000,
    });
  });

  test("対局の合法手は現在局へ委譲される", () => {
    const state = MahjongMatchRuleset.getInitialState(
      { playerIds: players },
      new ProvablyFairRNG("match-test", "legal", 0),
    );
    const actions = MahjongMatchRuleset.getLegalActions(state, "p1");

    expect(actions).toEqual([
      {
        type: "SUBGAME_ACTION",
        playerId: "p1",
        subAction: { type: "DRAW", playerId: "p1" },
      },
    ]);
  });
});
