import { expect, test, describe } from "bun:test";
import { ShogiRuleset } from "../ShogiRuleset";

describe("ShogiRuleset", () => {
  test("getInitialState should return correct initial state", () => {
    const state = ShogiRuleset.getInitialState();
    expect(state.status).toBe("WAITING");
    expect(state.board.length).toBe(81);
    expect(state.board[0]).toBe(-2); // Kyousha
    expect(state.board[4]).toBe(-8); // Oushou
    expect(state.board[80]).toBe(2); // Kyousha
  });

  test("isValidAction should validate basic moves", () => {
    const state = ShogiRuleset.getInitialState();
    state.status = "PLAYING";
    state.players = { 1: "p1", "-1": "p2" };

    // Valid move: FU (7, 7) to (7, 6) -> index 54+6=60 to 45+6=51? No, 0-80 index.
    // (x,y) -> y*9+x. (6,6) is 6*9+6 = 60. (6,5) is 5*9+6 = 51.
    expect(
      ShogiRuleset.isValidAction(state, {
        type: "MOVE",
        from: 60,
        to: 51,
        playerId: "p1",
      }),
    ).toBe(true);

    // Invalid: piece belongs to opponent
    expect(
      ShogiRuleset.isValidAction(state, {
        type: "MOVE",
        from: 20,
        to: 29,
        playerId: "p1",
      }),
    ).toBe(false);

    // Invalid: wrong turn
    expect(
      ShogiRuleset.isValidAction(state, {
        type: "MOVE",
        from: 60,
        to: 51,
        playerId: "p2",
      }),
    ).toBe(false);
  });

  test("reduce should handle captures and turns", () => {
    const state = ShogiRuleset.getInitialState();
    state.status = "PLAYING";

    // Move FU (6,6) to (6,5)
    let nextState = ShogiRuleset.reduce(state, {
      type: "MOVE",
      from: 60,
      to: 51,
    });
    expect(nextState.board[60]).toBe(0);
    expect(nextState.board[51]).toBe(1);
    expect(nextState.turn).toBe(-1);

    // Mock a capture
    state.turn = -1; // Gote's turn
    state.board[19] = -1; // Gote FU at (1,2)
    state.board[20] = 1; // Sente FU at (2,2)

    // Gote FU at index 19 takes Sente FU at index 20
    nextState = ShogiRuleset.reduce(state, { type: "MOVE", from: 19, to: 20 });
    expect(nextState.hands[-1][1]).toBe(1); // Gote has 1 FU in hand
    expect(nextState.board[19]).toBe(0);
    expect(nextState.board[20]).toBe(-1);
  });

  test("DROP should work correctly", () => {
    const state = ShogiRuleset.getInitialState();
    state.status = "PLAYING";
    state.hands[1][1] = 1; // Sente has 1 FU

    // Drop FU at (4,4) -> index 40
    const nextState = ShogiRuleset.reduce(state, {
      type: "DROP",
      piece: 1,
      to: 40,
    });
    expect(nextState.board[40]).toBe(1);
    expect(nextState.hands[1][1]).toBe(0);
  });

  test("Nifu (Double Pawn) should be invalid", () => {
    const state = ShogiRuleset.getInitialState();
    state.status = "PLAYING";
    state.hands[1][1] = 1;
    // There's already a FU at (0,6) -> index 54. Let's try to drop at (0,4) -> index 36
    expect(
      ShogiRuleset.isValidAction(state, {
        type: "DROP",
        piece: 1,
        to: 36,
        playerId: "p1",
      }),
    ).toBe(false);
  });
});
