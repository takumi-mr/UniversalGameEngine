import { expect, test, describe } from "bun:test";
import { TexasHoldemRuleset } from "../TexasHoldemRuleset";

describe("TexasHoldemRuleset", () => {
  const playerIds = ["p1", "p2", "p3"];

  test("getInitialState should set up players and deal cards", () => {
    const state = TexasHoldemRuleset.getInitialState({
      playerIds,
      initialChips: 500,
    });
    expect(state.playerIds).toEqual(playerIds);
    expect(state.playerChips["p1"]).toBe(500);
    expect(state.hands["p1"].value.length).toBe(2);
    expect(state.deck.value.length).toBe(52 - 6); // 52 - 2*3
  });

  test("isValidAction should validate betting logic", () => {
    const state = TexasHoldemRuleset.getInitialState({ playerIds });
    state.status = "PLAYING";
    state.activePlayers = ["p1"];
    state.currentBet = 100;
    state.playerBets["p1"] = 0;
    state.playerChips["p1"] = 500;

    // Fold is always valid
    expect(TexasHoldemRuleset.isValidAction(state, { type: "FOLD", playerId: "p1" })).toBe(true);

    // Call (100) is valid as player has 500 chips
    expect(TexasHoldemRuleset.isValidAction(state, { type: "CALL", playerId: "p1" })).toBe(true);

    // Raise (100) means total bet current (100) + raise (100) = 200. Valid.
    expect(
      TexasHoldemRuleset.isValidAction(state, {
        type: "RAISE",
        amount: 100,
        playerId: "p1",
      }),
    ).toBe(true);

    // Raise too much
    expect(
      TexasHoldemRuleset.isValidAction(state, {
        type: "RAISE",
        amount: 1000,
        playerId: "p1",
      }),
    ).toBe(false);

    // Check is invalid when there's a bet to call
    expect(
      TexasHoldemRuleset.isValidAction(state, {
        type: "CHECK",
        playerId: "p1",
      }),
    ).toBe(false);
  });

  test("getMaskedState should be handled by UniversalEngine automatic Masking instead of maskState hook", () => {
    // The hooking functionality was removed and is covered by Secret<T> directly.
  });

  test("reduce should update chips and pot on RAISE", () => {
    const state = TexasHoldemRuleset.getInitialState({ playerIds });
    state.status = "PLAYING";
    state.activePlayers = ["p1"];
    state.currentBet = 0;
    state.playerBets["p1"] = 0;
    state.playerChips["p1"] = 1000;

    const next = TexasHoldemRuleset.reduce(state, {
      type: "RAISE",
      amount: 100,
      playerId: "p1",
    });

    expect(next.playerChips["p1"]).toBe(900);
    expect(next.playerBets["p1"]).toBe(100);
    expect(next.pot).toBe(100);
    expect(next.currentBet).toBe(100);
    expect(next.activePlayers).toEqual(["p2"]); // Turn moves to p2
  });
});
