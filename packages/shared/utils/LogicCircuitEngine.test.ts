import { describe, it, expect } from "bun:test";
import { LogicCircuitEngine, type LogicBlock, type Connection } from "./LogicCircuitEngine";

describe("LogicCircuitEngine", () => {
  it("should simulate an AND gate correctly", () => {
    const blocks: Record<string, LogicBlock> = {
      in1: { id: "in1", type: "SWITCH", inputs: [], value: 1 },
      in2: { id: "in2", type: "SWITCH", inputs: [], value: 1 },
      and1: { id: "and1", type: "AND", inputs: [null, null], value: 0 },
    };
    const connections: Connection[] = [
      { fromBlockId: "in1", toBlockId: "and1", toPinIndex: 0 },
      { fromBlockId: "in2", toBlockId: "and1", toPinIndex: 1 },
    ];

    LogicCircuitEngine.simulate(blocks, connections);
    expect(blocks.and1.value).toBe(1);

    blocks.in1.value = 0;
    LogicCircuitEngine.simulate(blocks, connections);
    expect(blocks.and1.value).toBe(0);
  });

  it("should simulate an OR gate correctly", () => {
    const blocks: Record<string, LogicBlock> = {
      in1: { id: "in1", type: "SWITCH", inputs: [], value: 0 },
      in2: { id: "in2", type: "SWITCH", inputs: [], value: 1 },
      or1: { id: "or1", type: "OR", inputs: [null, null], value: 0 },
    };
    const connections: Connection[] = [
      { fromBlockId: "in1", toBlockId: "or1", toPinIndex: 0 },
      { fromBlockId: "in2", toBlockId: "or1", toPinIndex: 1 },
    ];

    LogicCircuitEngine.simulate(blocks, connections);
    expect(blocks.or1.value).toBe(1);

    blocks.in2.value = 0;
    LogicCircuitEngine.simulate(blocks, connections);
    expect(blocks.or1.value).toBe(0);
  });

  it("should simulate a NOT gate correctly", () => {
    const blocks: Record<string, LogicBlock> = {
      in1: { id: "in1", type: "SWITCH", inputs: [], value: 1 },
      not1: { id: "not1", type: "NOT", inputs: [null], value: 0 },
    };
    const connections: Connection[] = [{ fromBlockId: "in1", toBlockId: "not1", toPinIndex: 0 }];

    LogicCircuitEngine.simulate(blocks, connections);
    expect(blocks.not1.value).toBe(0);

    blocks.in1.value = 0;
    LogicCircuitEngine.simulate(blocks, connections);
    expect(blocks.not1.value).toBe(1);
  });

  it("should simulate an XOR gate correctly", () => {
    const blocks: Record<string, LogicBlock> = {
      in1: { id: "in1", type: "SWITCH", inputs: [], value: 1 },
      in2: { id: "in2", type: "SWITCH", inputs: [], value: 1 },
      xor1: { id: "xor1", type: "XOR", inputs: [null, null], value: 0 },
    };
    const connections: Connection[] = [
      { fromBlockId: "in1", toBlockId: "xor1", toPinIndex: 0 },
      { fromBlockId: "in2", toBlockId: "xor1", toPinIndex: 1 },
    ];

    LogicCircuitEngine.simulate(blocks, connections);
    expect(blocks.xor1.value).toBe(0);

    blocks.in1.value = 0;
    LogicCircuitEngine.simulate(blocks, connections);
    expect(blocks.xor1.value).toBe(1);
  });

  it("should handle propagation through multiple gates", () => {
    // (A AND B) OR NOT C
    const blocks: Record<string, LogicBlock> = {
      A: { id: "A", type: "SWITCH", inputs: [], value: 1 },
      B: { id: "B", type: "SWITCH", inputs: [], value: 0 },
      C: { id: "C", type: "SWITCH", inputs: [], value: 1 },
      and1: { id: "and1", type: "AND", inputs: [null, null], value: 0 },
      not1: { id: "not1", type: "NOT", inputs: [null], value: 0 },
      or1: { id: "or1", type: "OR", inputs: [null, null], value: 0 },
    };
    const connections: Connection[] = [
      { fromBlockId: "A", toBlockId: "and1", toPinIndex: 0 },
      { fromBlockId: "B", toBlockId: "and1", toPinIndex: 1 },
      { fromBlockId: "C", toBlockId: "not1", toPinIndex: 0 },
      { fromBlockId: "and1", toBlockId: "or1", toPinIndex: 0 },
      { fromBlockId: "not1", toBlockId: "or1", toPinIndex: 1 },
    ];

    LogicCircuitEngine.simulate(blocks, connections);
    // (1 AND 0) OR (NOT 1) = 0 OR 0 = 0
    expect(blocks.or1.value).toBe(0);

    blocks.B.value = 1;
    LogicCircuitEngine.simulate(blocks, connections);
    // (1 AND 1) OR (NOT 1) = 1 OR 0 = 1
    expect(blocks.or1.value).toBe(1);
  });

  it("should simulate a D flip-flop on rising edge", () => {
    const blocks: Record<string, LogicBlock> = {
      D: { id: "D", type: "SWITCH", inputs: [], value: 1 },
      CLK: { id: "CLK", type: "SWITCH", inputs: [], value: 0 },
      dff1: { id: "dff1", type: "D_FLIP_FLOP", inputs: [null, null], value: 0, lastClock: 0 },
    };
    const connections: Connection[] = [
      { fromBlockId: "D", toBlockId: "dff1", toPinIndex: 0 },
      { fromBlockId: "CLK", toBlockId: "dff1", toPinIndex: 1 },
    ];

    // No clock edge
    LogicCircuitEngine.simulate(blocks, connections);
    expect(blocks.dff1.value).toBe(0);

    // Rising edge
    blocks.CLK.value = 1;
    LogicCircuitEngine.simulate(blocks, connections);
    expect(blocks.dff1.value).toBe(1);

    // D changes but no clock edge
    blocks.D.value = 0;
    LogicCircuitEngine.simulate(blocks, connections);
    expect(blocks.dff1.value).toBe(1);

    // Falling edge
    blocks.CLK.value = 0;
    LogicCircuitEngine.simulate(blocks, connections);
    expect(blocks.dff1.value).toBe(1);
  });
});
