import { describe, it, expect } from "bun:test";
import {
  LogicCircuitEngine,
  type LogicBlock,
  type Connection,
  type SubCircuit,
} from "./LogicCircuitEngine";

describe("LogicCircuitEngine", () => {
  it("should simulate an AND gate correctly", () => {
    const blocks: Record<string, LogicBlock> = {
      in1: { id: "in1", type: "SWITCH", outputs: [1] },
      in2: { id: "in2", type: "SWITCH", outputs: [1] },
      and1: { id: "and1", type: "AND", outputs: [0] },
    };
    const connections: Connection[] = [
      { fromBlockId: "in1", fromPinIndex: 0, toBlockId: "and1", toPinIndex: 0 },
      { fromBlockId: "in2", fromPinIndex: 0, toBlockId: "and1", toPinIndex: 1 },
    ];

    LogicCircuitEngine.simulate(blocks, connections);
    expect(blocks.and1.outputs[0]).toBe(1);

    blocks.in1.outputs[0] = 0;
    LogicCircuitEngine.simulate(blocks, connections);
    expect(blocks.and1.outputs[0]).toBe(0);
  });

  it("should simulate an OR gate correctly", () => {
    const blocks: Record<string, LogicBlock> = {
      in1: { id: "in1", type: "SWITCH", outputs: [0] },
      in2: { id: "in2", type: "SWITCH", outputs: [1] },
      or1: { id: "or1", type: "OR", outputs: [0] },
    };
    const connections: Connection[] = [
      { fromBlockId: "in1", fromPinIndex: 0, toBlockId: "or1", toPinIndex: 0 },
      { fromBlockId: "in2", fromPinIndex: 0, toBlockId: "or1", toPinIndex: 1 },
    ];

    LogicCircuitEngine.simulate(blocks, connections);
    expect(blocks.or1.outputs[0]).toBe(1);

    blocks.in2.outputs[0] = 0;
    LogicCircuitEngine.simulate(blocks, connections);
    expect(blocks.or1.outputs[0]).toBe(0);
  });

  it("should simulate a NOT gate correctly", () => {
    const blocks: Record<string, LogicBlock> = {
      in1: { id: "in1", type: "SWITCH", outputs: [1] },
      not1: { id: "not1", type: "NOT", outputs: [0] },
    };
    const connections: Connection[] = [
      { fromBlockId: "in1", fromPinIndex: 0, toBlockId: "not1", toPinIndex: 0 },
    ];

    LogicCircuitEngine.simulate(blocks, connections);
    expect(blocks.not1.outputs[0]).toBe(0);

    blocks.in1.outputs[0] = 0;
    LogicCircuitEngine.simulate(blocks, connections);
    expect(blocks.not1.outputs[0]).toBe(1);
  });

  it("should simulate a D flip-flop on rising edge", () => {
    const blocks: Record<string, LogicBlock> = {
      D: { id: "D", type: "SWITCH", outputs: [1] },
      CLK: { id: "CLK", type: "SWITCH", outputs: [0] },
      dff1: { id: "dff1", type: "D_FLIP_FLOP", outputs: [0], lastClock: 0 },
    };
    const connections: Connection[] = [
      { fromBlockId: "D", fromPinIndex: 0, toBlockId: "dff1", toPinIndex: 0 },
      { fromBlockId: "CLK", fromPinIndex: 0, toBlockId: "dff1", toPinIndex: 1 },
    ];

    LogicCircuitEngine.simulate(blocks, connections);
    expect(blocks.dff1.outputs[0]).toBe(0);

    blocks.CLK.outputs[0] = 1;
    LogicCircuitEngine.simulate(blocks, connections);
    expect(blocks.dff1.outputs[0]).toBe(1);
  });

  it("should simulate a compound block (Half Adder)", () => {
    // Define a Half Adder sub-circuit
    const haCircuit: SubCircuit = {
      blocks: {
        in1: { id: "in1", type: "SWITCH", outputs: [0] }, // A
        in2: { id: "in2", type: "SWITCH", outputs: [0] }, // B
        xor1: { id: "xor1", type: "XOR", outputs: [0] },
        and1: { id: "and1", type: "AND", outputs: [0] },
        out1: { id: "out1", type: "LED", outputs: [0] }, // Sum
        out2: { id: "out2", type: "LED", outputs: [0] }, // Carry
      },
      connections: [
        { fromBlockId: "in1", fromPinIndex: 0, toBlockId: "xor1", toPinIndex: 0 },
        { fromBlockId: "in2", fromPinIndex: 0, toBlockId: "xor1", toPinIndex: 1 },
        { fromBlockId: "in1", fromPinIndex: 0, toBlockId: "and1", toPinIndex: 0 },
        { fromBlockId: "in2", fromPinIndex: 0, toBlockId: "and1", toPinIndex: 1 },
        { fromBlockId: "xor1", fromPinIndex: 0, toBlockId: "out1", toPinIndex: 0 },
        { fromBlockId: "and1", fromPinIndex: 0, toBlockId: "out2", toPinIndex: 0 },
      ],
    };

    const blocks: Record<string, LogicBlock> = {
      A: { id: "A", type: "SWITCH", outputs: [1] },
      B: { id: "B", type: "SWITCH", outputs: [1] },
      ha: { id: "ha", type: "HALF_ADDER_REUSABLE", outputs: [0, 0], compound: haCircuit },
    };
    const connections: Connection[] = [
      { fromBlockId: "A", fromPinIndex: 0, toBlockId: "ha", toPinIndex: 0 },
      { fromBlockId: "B", fromPinIndex: 0, toBlockId: "ha", toPinIndex: 1 },
    ];

    LogicCircuitEngine.simulate(blocks, connections);
    // 1 + 1 = 0 Carry 1
    expect(blocks.ha.outputs[0]).toBe(0); // Sum
    expect(blocks.ha.outputs[1]).toBe(1); // Carry

    blocks.B.outputs[0] = 0;
    LogicCircuitEngine.simulate(blocks, connections);
    // 1 + 0 = 1 Carry 0
    expect(blocks.ha.outputs[0]).toBe(1);
    expect(blocks.ha.outputs[1]).toBe(0);
  });

  it("should simulate a ROM block", () => {
    const blocks: Record<string, LogicBlock> = {
      rom1: {
        id: "rom1",
        type: "ROM",
        outputs: [0, 0, 0, 0, 0, 0, 0, 0],
        romData: [0, 0, 0, 0x42], // Address 3 has 0x42
      },
      addr0: { id: "addr0", type: "SWITCH", outputs: [1] }, // 2^0 = 1
      addr1: { id: "addr1", type: "SWITCH", outputs: [1] }, // 2^1 = 2 -> total addr 3
    };
    const connections: Connection[] = [
      { fromBlockId: "addr0", fromPinIndex: 0, toBlockId: "rom1", toPinIndex: 0 },
      { fromBlockId: "addr1", fromPinIndex: 0, toBlockId: "rom1", toPinIndex: 1 },
    ];

    LogicCircuitEngine.simulate(blocks, connections);
    // 0x42 = 0100 0010
    expect(blocks.rom1.outputs).toEqual([0, 1, 0, 0, 0, 0, 1, 0]);
  });

  it("should simulate a RAM block with clock edges", () => {
    const memory = new Array(16).fill(0);
    const blocks: Record<string, LogicBlock> = {
      ram1: { id: "ram1", type: "RAM", outputs: [0, 0, 0, 0], memory },
      clk: { id: "clk", type: "SWITCH", outputs: [0] },
      we: { id: "we", type: "SWITCH", outputs: [1] },
      data0: { id: "data0", type: "SWITCH", outputs: [1] }, // Data = 1
      addr0: { id: "addr0", type: "SWITCH", outputs: [0] }, // Addr = 0
    };
    const connections: Connection[] = [
      { fromBlockId: "clk", fromPinIndex: 0, toBlockId: "ram1", toPinIndex: 9 },
      { fromBlockId: "we", fromPinIndex: 0, toBlockId: "ram1", toPinIndex: 8 },
      { fromBlockId: "data0", fromPinIndex: 0, toBlockId: "ram1", toPinIndex: 4 },
      { fromBlockId: "addr0", fromPinIndex: 0, toBlockId: "ram1", toPinIndex: 0 },
    ];

    // 1. Initial state (Clk 0)
    LogicCircuitEngine.simulate(blocks, connections);
    expect(blocks.ram1.memory?.[0]).toBe(0);

    // 2. Clock rising edge
    blocks.clk.outputs = [1];
    LogicCircuitEngine.simulate(blocks, connections);
    expect(blocks.ram1.memory?.[0]).toBe(1);
    expect(blocks.ram1.outputs).toEqual([1, 0, 0, 0]);

    // 3. Change data but no clock edge
    blocks.data0.outputs = [0];
    LogicCircuitEngine.simulate(blocks, connections);
    expect(blocks.ram1.memory?.[0]).toBe(1); // Still 1

    // 4. Falling edge then rising edge again
    blocks.clk.outputs = [0];
    LogicCircuitEngine.simulate(blocks, connections);
    blocks.clk.outputs = [1];
    LogicCircuitEngine.simulate(blocks, connections);
    expect(blocks.ram1.memory?.[0]).toBe(0); // Updated to 0
    expect(blocks.ram1.outputs).toEqual([0, 0, 0, 0]);
  });
});
