import { expect, test, describe } from "bun:test";
import { TowerOfHanoiRuleset } from "../TowerOfHanoiRuleset";

describe("TowerOfHanoiRuleset", () => {
  test("getInitialState should return correct initial state", () => {
    const state = TowerOfHanoiRuleset.getInitialState({ diskCount: 3 });
    expect(state.status).toBe("PLAYING");
    expect(state.diskCount).toBe(3);
    expect(state.towers).toEqual([[3, 2, 1], [], []]);
    expect(state.moves).toBe(0);
  });

  test("isValidAction should validate correctly", () => {
    const state = TowerOfHanoiRuleset.getInitialState({ diskCount: 3 });

    // Valid move (3,2,1) -> (3,2), (1)
    expect(TowerOfHanoiRuleset.isValidAction(state, { type: "MOVE", from: 0, to: 1 })).toBe(true);

    // Invalid move: empty tower
    expect(TowerOfHanoiRuleset.isValidAction(state, { type: "MOVE", from: 1, to: 2 })).toBe(false);

    // Invalid move: larger on smaller
    const state2 = { ...state, towers: [[3, 2], [1], []] };
    expect(TowerOfHanoiRuleset.isValidAction(state2, { type: "MOVE", from: 0, to: 1 })).toBe(false);

    // Valid move: smaller on larger
    expect(TowerOfHanoiRuleset.isValidAction(state2, { type: "MOVE", from: 1, to: 0 })).toBe(true);
  });

  test("reduce should update towers and moves", () => {
    const state = TowerOfHanoiRuleset.getInitialState({ diskCount: 3 });
    const nextState = TowerOfHanoiRuleset.reduce(state, { type: "MOVE", from: 0, to: 1 });

    expect(nextState.towers).toEqual([[3, 2], [1], []]);
    expect(nextState.moves).toBe(1);

    const secondState = TowerOfHanoiRuleset.reduce(nextState, { type: "MOVE", from: 0, to: 2 });
    expect(secondState.towers).toEqual([[3], [1], [2]]);
    expect(secondState.moves).toBe(2);
  });

  test("checkWinCondition should detect clear", () => {
    const state = {
      status: "PLAYING" as const,
      towers: [[], [], [3, 2, 1]],
      moves: 7,
      diskCount: 3,
    };
    const result = TowerOfHanoiRuleset.checkWinCondition(state);
    expect(result.isFinished).toBe(true);
    expect(result.message).toContain("Clear");
  });

  test("RESET action should reset state", () => {
    const state = {
      status: "FINISHED" as const,
      towers: [[], [], [3, 2, 1]],
      moves: 7,
      diskCount: 3,
    };
    const nextState = TowerOfHanoiRuleset.reduce(state, { type: "RESET", diskCount: 4 });
    expect(nextState.status).toBe("PLAYING");
    expect(nextState.diskCount).toBe(4);
    expect(nextState.towers[0]).toEqual([4, 3, 2, 1]);
    expect(nextState.moves).toBe(0);
  });
});
