import { describe, it, expect } from "bun:test";
import { LogicCircuitRuleset } from "../LogicCircuitRuleset";

describe("LogicCircuitRuleset", () => {
  it("should have an initial state with no blocks", () => {
    const initialState = LogicCircuitRuleset.getInitialState();
    expect(initialState.blocks).toEqual({});
    expect(initialState.connections).toEqual([]);
    expect(initialState.status).toBe("PLAYING");
  });

  it("should add a block via reduce", () => {
    let state = LogicCircuitRuleset.getInitialState();
    state = LogicCircuitRuleset.reduce(state, { type: "ADD_BLOCK", gateType: "AND", x: 10, y: 20 });

    const blockIds = Object.keys(state.blocks);
    expect(blockIds.length).toBe(1);
    const block = state.blocks[blockIds[0]];
    expect(block.type).toBe("AND");
    expect(block.x).toBe(10);
    expect(block.y).toBe(20);
  });

  it("should remove a block and its connections", () => {
    let state = LogicCircuitRuleset.getInitialState();
    state = LogicCircuitRuleset.reduce(state, { type: "ADD_BLOCK", gateType: "AND" });
    const andId = Object.keys(state.blocks)[0];
    state = LogicCircuitRuleset.reduce(state, { type: "ADD_BLOCK", gateType: "SWITCH" });
    const swId = Object.keys(state.blocks)[1];

    state = LogicCircuitRuleset.reduce(state, {
      type: "CONNECT",
      fromBlockId: swId,
      toBlockId: andId,
      toPinIndex: 0,
    });

    expect(state.connections.length).toBe(1);

    state = LogicCircuitRuleset.reduce(state, { type: "REMOVE_BLOCK", blockId: andId });
    expect(state.blocks[andId]).toBeUndefined();
    expect(state.connections.length).toBe(0);
  });

  it("should toggle a switch", () => {
    let state = LogicCircuitRuleset.getInitialState();
    state = LogicCircuitRuleset.reduce(state, { type: "ADD_BLOCK", gateType: "SWITCH" });
    const swId = Object.keys(state.blocks)[0];

    expect(state.blocks[swId].value).toBe(0);
    state = LogicCircuitRuleset.reduce(state, { type: "TOGGLE_SWITCH", blockId: swId });
    expect(state.blocks[swId].value).toBe(1);
  });
});
