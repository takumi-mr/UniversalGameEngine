import { expect, test, describe } from "bun:test";
import { HakoiriMusumeRuleset } from "../HakoiriMusumeRuleset";

describe("HakoiriMusumeRuleset", () => {
  test("getInitialState should return correct grid and blocks", () => {
    const state = HakoiriMusumeRuleset.getInitialState();
    expect(state.status).toBe("PLAYING");
    expect(state.blocks.length).toBe(10);
    expect(state.moveCount).toBe(0);

    const musume = state.blocks.find((b) => b.id === "musume");
    expect(musume).toBeDefined();
    expect(musume?.x).toBe(1);
    expect(musume?.y).toBe(0);
    expect(musume?.width).toBe(2);
    expect(musume?.height).toBe(2);
  });

  test("isValidAction should correctly validate moves", () => {
    const state = HakoiriMusumeRuleset.getInitialState();

    // Musume cannot move at start (blocked)
    expect(
      HakoiriMusumeRuleset.isValidAction(state, {
        type: "MOVE",
        blockId: "musume",
        direction: "D",
      }),
    ).toBe(false);

    // Child 1 can move down (it's at (1,3), empty cells at (1,4), (2,4))
    expect(
      HakoiriMusumeRuleset.isValidAction(state, {
        type: "MOVE",
        blockId: "child1",
        direction: "D",
      }),
    ).toBe(true);

    // Child 3 is at (0,4), cannot move down (border)
    expect(
      HakoiriMusumeRuleset.isValidAction(state, {
        type: "MOVE",
        blockId: "child3",
        direction: "D",
      }),
    ).toBe(false);
  });

  test("reduce should update block position", () => {
    let state = HakoiriMusumeRuleset.getInitialState();
    const action = { type: "MOVE", blockId: "child1", direction: "D" } as const;

    state = HakoiriMusumeRuleset.reduce(state, action);
    const child1 = state.blocks.find((b) => b.id === "child1");
    expect(child1?.y).toBe(4);
    expect(state.moveCount).toBe(1);
  });

  test("win condition should be detected", () => {
    const state = HakoiriMusumeRuleset.getInitialState();
    // Manually set musume to win position
    const winState = {
      ...state,
      blocks: state.blocks.map((b) => (b.id === "musume" ? { ...b, x: 1, y: 3 } : b)),
    };

    const winResult = HakoiriMusumeRuleset.checkWinCondition(winState);
    expect(winResult.isFinished).toBe(true);
  });

  test("getLegalActions should return available moves", () => {
    const state = HakoiriMusumeRuleset.getInitialState();
    const legalActions = HakoiriMusumeRuleset.getLegalActions(state, "player1");

    // Initially, Child 1 (D), Child 2 (D), Brother (D?) - wait, brother is at (1,2) with height 1?
    // Brother is at (1,2), Child 1/2 are at (1,3), (2,3).
    // Empty cells are at (1,4), (2,4).
    // So Child 1 (D), Child 2 (D), Child 3 (R), Child 4 (L) can move.
    expect(legalActions.length).toBe(4);
    expect(legalActions.some((a) => a.blockId === "child1" && a.direction === "D")).toBe(true);
    expect(legalActions.some((a) => a.blockId === "child2" && a.direction === "D")).toBe(true);
  });
});
