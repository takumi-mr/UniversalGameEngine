import { describe, it, expect } from "bun:test";
import { LogicLabRuleset, LOGIC_LAB_LEVELS } from "../LogicLabRuleset";

describe("LogicLabRuleset", () => {
  it("should initialize level 1 with input and output blocks", () => {
    const initialState = LogicLabRuleset.getInitialState({ levelId: 1 });
    const level1 = LOGIC_LAB_LEVELS[0];

    expect(initialState.currentLevelId).toBe(1);
    expect(Object.keys(initialState.blocks).length).toBe(
      level1.inputBlocks.length + level1.outputBlocks.length,
    );
    expect(initialState.blocks["in1"].type).toBe("SWITCH");
    expect(initialState.blocks["out1"].type).toBe("LED");
  });

  it("should check solution for level 1 (NOT gate)", () => {
    let state = LogicLabRuleset.getInitialState({ levelId: 1 });

    // Add a NOT gate
    state = LogicLabRuleset.reduce(state, { type: "ADD_BLOCK", gateType: "NOT" });
    const notId = Object.keys(state.blocks).find((id) => state.blocks[id].type === "NOT")!;

    // Connect in1 -> not -> out1
    state = LogicLabRuleset.reduce(state, {
      type: "CONNECT",
      fromBlockId: "in1",
      toBlockId: notId,
      toPinIndex: 0,
    });
    state = LogicLabRuleset.reduce(state, {
      type: "CONNECT",
      fromBlockId: notId,
      toBlockId: "out1",
      toPinIndex: 0,
    });

    // Check solution
    state = LogicLabRuleset.reduce(state, { type: "CHECK_SOLUTION" });

    expect(state.testResults.length).toBe(2);
    expect(state.testResults.every((r) => r === true)).toBe(true);

    const winStatus = LogicLabRuleset.checkWinCondition(state);
    expect(winStatus.isFinished).toBe(true);
  });

  it("should not allow adding restricted gates", () => {
    let state = LogicLabRuleset.getInitialState({ levelId: 1 }); // Level 1 only allows NOT, SWITCH, LED
    const initialBlockCount = Object.keys(state.blocks).length;

    state = LogicLabRuleset.reduce(state, { type: "ADD_BLOCK", gateType: "AND" });
    expect(Object.keys(state.blocks).length).toBe(initialBlockCount);
  });

  it("should not allow removing input/output blocks", () => {
    let state = LogicLabRuleset.getInitialState({ levelId: 1 });
    const initialBlockCount = Object.keys(state.blocks).length;

    state = LogicLabRuleset.reduce(state, { type: "REMOVE_BLOCK", blockId: "in1" });
    expect(Object.keys(state.blocks).length).toBe(initialBlockCount);
  });
});
