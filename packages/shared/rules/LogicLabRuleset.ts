import type { BaseGameState, GameRuleset } from "../GameRules";
import type { IGameRNG } from "../utils/IGameRNG";
import {
  LogicCircuitEngine,
  type LogicBlockType,
  type LogicBlock,
  type Connection,
  type SubCircuit,
} from "../utils/LogicCircuitEngine";

export interface TestCase {
  inputs?: Record<string, number>; // blockId -> value
  outputs?: Record<string, number | number[]>; // blockId -> value or array of values
  initialBlockState?: Record<string, Partial<LogicBlock>>; // Initial state for blocks (e.g. ROM data)
  cycles?: number; // Number of simulation cycles to run
}

export interface LogicLabLevel {
  id: number;
  name: string;
  description: string;
  allowedGates: (LogicBlockType | string)[];
  testCases: TestCase[];
  inputBlocks: { id: string; label: string }[];
  outputBlocks: { id: string; label: string }[];
}

export interface LogicLabState extends BaseGameState {
  currentLevelId: number;
  blocks: Record<string, LogicBlock>;
  connections: Connection[];
  testResults: boolean[];
  unlockedLevels: number[];
  customBlocks: Record<string, { name: string; compound: SubCircuit }>;
}

export type LogicLabAction =
  | { type: "ADD_BLOCK"; gateType: LogicBlockType; x?: number; y?: number }
  | { type: "ADD_CUSTOM_BLOCK"; levelId: number; x?: number; y?: number }
  | { type: "REMOVE_BLOCK"; blockId: string }
  | { type: "MOVE_BLOCK"; blockId: string; x: number; y: number }
  | {
      type: "CONNECT";
      fromBlockId: string;
      fromPinIndex: number;
      toBlockId: string;
      toPinIndex: number;
    }
  | { type: "DISCONNECT"; fromBlockId: string; toBlockId: string; toPinIndex: number }
  | { type: "TOGGLE_SWITCH"; blockId: string }
  | { type: "ROM_SET_DATA"; blockId: string; data: number[] }
  | { type: "CHECK_SOLUTION" }
  | { type: "RESET" }
  | { type: "NEXT_LEVEL" };

// Level definitions
export const LOGIC_LAB_LEVELS: LogicLabLevel[] = [
  {
    id: 1,
    name: "NOT Gate",
    description: "Build a NOT gate.",
    allowedGates: ["NOT", "SWITCH", "LED"],
    inputBlocks: [{ id: "in1", label: "A" }],
    outputBlocks: [{ id: "out1", label: "Y" }],
    testCases: [
      { inputs: { in1: 0 }, outputs: { out1: 1 } },
      { inputs: { in1: 1 }, outputs: { out1: 0 } },
    ],
  },
  {
    id: 2,
    name: "AND Gate",
    description: "Output 1 only if both inputs are 1.",
    allowedGates: ["AND", "SWITCH", "LED"],
    inputBlocks: [
      { id: "in1", label: "A" },
      { id: "in2", label: "B" },
    ],
    outputBlocks: [{ id: "out1", label: "Y" }],
    testCases: [
      { inputs: { in1: 0, in2: 0 }, outputs: { out1: 0 } },
      { inputs: { in1: 0, in2: 1 }, outputs: { out1: 0 } },
      { inputs: { in1: 1, in2: 0 }, outputs: { out1: 0 } },
      { inputs: { in1: 1, in2: 1 }, outputs: { out1: 1 } },
    ],
  },
  {
    id: 3,
    name: "OR Gate",
    description: "Output 1 if either input is 1.",
    allowedGates: ["OR", "SWITCH", "LED"],
    inputBlocks: [
      { id: "in1", label: "A" },
      { id: "in2", label: "B" },
    ],
    outputBlocks: [{ id: "out1", label: "Y" }],
    testCases: [
      { inputs: { in1: 0, in2: 0 }, outputs: { out1: 0 } },
      { inputs: { in1: 0, in2: 1 }, outputs: { out1: 1 } },
      { inputs: { in1: 1, in2: 0 }, outputs: { out1: 1 } },
      { inputs: { in1: 1, in2: 1 }, outputs: { out1: 1 } },
    ],
  },
  {
    id: 4,
    name: "XOR from Basic Gates",
    description: "Build an XOR gate using only AND, OR, and NOT.",
    allowedGates: ["AND", "OR", "NOT", "SWITCH", "LED"],
    inputBlocks: [
      { id: "in1", label: "A" },
      { id: "in2", label: "B" },
    ],
    outputBlocks: [{ id: "out1", label: "Y" }],
    testCases: [
      { inputs: { in1: 0, in2: 0 }, outputs: { out1: 0 } },
      { inputs: { in1: 0, in2: 1 }, outputs: { out1: 1 } },
      { inputs: { in1: 1, in2: 0 }, outputs: { out1: 1 } },
      { inputs: { in1: 1, in2: 1 }, outputs: { out1: 0 } },
    ],
  },
  {
    id: 5,
    name: "Half Adder",
    description: "A+B = Sum, Carry.",
    allowedGates: ["AND", "OR", "NOT", "XOR", "SWITCH", "LED"],
    inputBlocks: [
      { id: "in1", label: "A" },
      { id: "in2", label: "B" },
    ],
    outputBlocks: [
      { id: "out1", label: "Sum" },
      { id: "out2", label: "Carry" },
    ],
    testCases: [
      { inputs: { in1: 0, in2: 0 }, outputs: { out1: 0, out2: 0 } },
      { inputs: { in1: 0, in2: 1 }, outputs: { out1: 1, out2: 0 } },
      { inputs: { in1: 1, in2: 0 }, outputs: { out1: 1, out2: 0 } },
      { inputs: { in1: 1, in2: 1 }, outputs: { out1: 0, out2: 1 } },
    ],
  },
  {
    id: 6,
    name: "Full Adder",
    description: "A+B+Cin = Sum, Cout. Use your Half Adder!",
    allowedGates: ["AND", "OR", "XOR", "SWITCH", "LED"],
    inputBlocks: [
      { id: "in1", label: "A" },
      { id: "in2", label: "B" },
      { id: "in3", label: "Cin" },
    ],
    outputBlocks: [
      { id: "out1", label: "Sum" },
      { id: "out2", label: "Cout" },
    ],
    testCases: [
      { inputs: { in1: 0, in2: 0, in3: 0 }, outputs: { out1: 0, out2: 0 } },
      { inputs: { in1: 1, in2: 0, in3: 0 }, outputs: { out1: 1, out2: 0 } },
      { inputs: { in1: 0, in2: 1, in3: 0 }, outputs: { out1: 1, out2: 0 } },
      { inputs: { in1: 1, in2: 1, in3: 0 }, outputs: { out1: 0, out2: 1 } },
      { inputs: { in1: 0, in2: 0, in3: 1 }, outputs: { out1: 1, out2: 0 } },
      { inputs: { in1: 1, in2: 0, in3: 1 }, outputs: { out1: 0, out2: 1 } },
      { inputs: { in1: 0, in2: 1, in3: 1 }, outputs: { out1: 0, out2: 1 } },
      { inputs: { in1: 1, in2: 1, in3: 1 }, outputs: { out1: 1, out2: 1 } },
    ],
  },
  {
    id: 7,
    name: "1-bit ALU",
    description: "Simple ALU: Sum, Carry, AND, OR. Select inputs decide.",
    allowedGates: ["AND", "OR", "XOR", "NOT", "SWITCH", "LED"],
    inputBlocks: [
      { id: "in1", label: "A" },
      { id: "in2", label: "B" },
      { id: "in3", label: "Cin" },
      { id: "in4", label: "S0" },
      { id: "in5", label: "S1" },
    ],
    outputBlocks: [
      { id: "out1", label: "Result" },
      { id: "out2", label: "Cout" },
    ],
    testCases: [
      { inputs: { in1: 1, in2: 0, in3: 0, in4: 0, in5: 0 }, outputs: { out1: 0 } },
      { inputs: { in1: 1, in2: 1, in3: 0, in4: 0, in5: 0 }, outputs: { out1: 1 } },
      { inputs: { in1: 1, in2: 0, in3: 0, in4: 1, in5: 0 }, outputs: { out1: 1 } },
      { inputs: { in1: 1, in2: 1, in3: 1, in4: 0, in5: 1 }, outputs: { out1: 1, out2: 1 } },
    ],
  },
  {
    id: 8,
    name: "4-bit Register",
    description: "Store a 4-bit value on clock rising edge when WE is 1.",
    allowedGates: ["D_FLIP_FLOP", "AND", "OR", "NOT", "SWITCH", "LED"],
    inputBlocks: [
      { id: "in1", label: "D0" },
      { id: "in2", label: "D1" },
      { id: "in3", label: "D2" },
      { id: "in4", label: "D3" },
      { id: "in5", label: "WE" },
      { id: "in6", label: "CLK" },
    ],
    outputBlocks: [
      { id: "out1", label: "Q0" },
      { id: "out2", label: "Q1" },
      { id: "out3", label: "Q2" },
      { id: "out4", label: "Q3" },
    ],
    testCases: [
      {
        inputs: { in1: 1, in2: 0, in3: 1, in4: 1, in5: 1, in6: 1 },
        cycles: 2,
        outputs: { out1: 1, out2: 0, out3: 1, out4: 1 },
      },
    ],
  },
  {
    id: 9,
    name: "4-bit Counter",
    description: "Build a counter that increments on every clock pulse.",
    allowedGates: ["D_FLIP_FLOP", "AND", "OR", "NOT", "XOR", "SWITCH", "LED"],
    inputBlocks: [{ id: "in1", label: "CLK" }],
    outputBlocks: [
      { id: "out1", label: "Q0" },
      { id: "out2", label: "Q1" },
      { id: "out3", label: "Q2" },
      { id: "out4", label: "Q3" },
    ],
    testCases: [
      { inputs: { in1: 1 }, cycles: 2, outputs: { out1: 1, out2: 0, out3: 0, out4: 0 } },
      { inputs: { in1: 1 }, cycles: 4, outputs: { out1: 0, out2: 1, out3: 0, out4: 0 } },
    ],
  },
  {
    id: 10,
    name: "Instruction Decoder",
    description: "Decode a 4-bit opcode into control signals for the CPU.",
    allowedGates: ["AND", "OR", "NOT", "SWITCH", "LED"],
    inputBlocks: [
      { id: "in1", label: "OP0" },
      { id: "in2", label: "OP1" },
      { id: "in3", label: "OP2" },
      { id: "in4", label: "OP3" },
    ],
    outputBlocks: [
      { id: "out1", label: "ALU_ADD" },
      { id: "out2", label: "RAM_WE" },
      { id: "out3", label: "REG_A_WE" },
    ],
    testCases: [
      { inputs: { in1: 0, in2: 0, in3: 1, in4: 0 }, outputs: { out1: 1 } }, // ADD (Op 4)
      { inputs: { in1: 1, in2: 1, in3: 0, in4: 0 }, outputs: { out2: 1 } }, // STORE (Op 3)
    ],
  },
  {
    id: 11,
    name: "4-bit CPU Integration",
    description: "Assemble all components into a working 4-bit CPU!",
    allowedGates: ["ROM", "RAM", "AND", "OR", "NOT", "SWITCH", "LED"],
    inputBlocks: [{ id: "clock", label: "CLK" }],
    outputBlocks: [{ id: "out1", label: "HALT" }],
    testCases: [
      {
        initialBlockState: {
          rom1: { romData: [0x15, 0x12, 0x40, 0x01] }, // LOAD A,5; LOAD B,2; ADD; HALT
        },
        inputs: { clock: 0 },
        cycles: 20,
        outputs: { out1: 1 },
      },
    ],
  },
  {
    id: 12,
    name: "Fibonacci Challenge",
    description: "Write an assembly program to calculate the Fibonacci sequence.",
    allowedGates: ["ROM", "RAM", "AND", "OR", "NOT", "SWITCH", "LED"],
    inputBlocks: [{ id: "clock", label: "CLK" }],
    outputBlocks: [{ id: "out1", label: "DONE" }],
    testCases: [
      {
        initialBlockState: {
          rom1: { romData: [0x11, 0x3a, 0x11, 0x3b, 0x40, 0x3a] }, // Loop-based Fib
        },
        inputs: { clock: 0 },
        cycles: 100,
        outputs: { out1: 1 },
      },
    ],
  },
];

export const LogicLabRuleset: GameRuleset<LogicLabState, any> = {
  getInitialState: (options?: { levelId?: number }, _rng?: IGameRNG): LogicLabState => {
    const levelId = options?.levelId || 1;
    const level = LOGIC_LAB_LEVELS.find((l) => l.id === levelId) || LOGIC_LAB_LEVELS[0];

    const blocks: Record<string, LogicBlock> = {};
    level.inputBlocks.forEach((ib, idx) => {
      blocks[ib.id] = {
        id: ib.id,
        type: "SWITCH",
        outputs: [0],
        x: 50,
        y: 100 + idx * 80,
      };
    });
    level.outputBlocks.forEach((ob, idx) => {
      blocks[ob.id] = { id: ob.id, type: "LED", outputs: [0], x: 800, y: 100 + idx * 80 };
    });

    return {
      status: "PLAYING",
      currentLevelId: levelId,
      blocks,
      connections: [],
      testResults: [],
      activePlayers: [],
      unlockedLevels: [],
      customBlocks: {},
    };
  },

  isValidAction: (_state, _action) => true,

  reduce: (state, action, _rng?: IGameRNG) => {
    const newState = structuredClone(state);

    switch (action.type) {
      case "ADD_BLOCK": {
        const level = LOGIC_LAB_LEVELS.find((l) => l.id === newState.currentLevelId);
        if (level && level.allowedGates.includes(action.gateType)) {
          const id = `${action.gateType.toLowerCase()}_${Math.random().toString(36).substr(2, 5)}`;
          newState.blocks[id] = {
            id,
            type: action.gateType,
            outputs: action.gateType === "ROM" ? [0, 0, 0, 0, 0, 0, 0, 0] : [0],
            x: action.x || 200,
            y: action.y || 200,
          };
        }
        break;
      }
      case "ADD_CUSTOM_BLOCK": {
        const custom = newState.customBlocks[action.levelId];
        if (custom) {
          const id = `custom_${action.levelId}_${Math.random().toString(36).substr(2, 5)}`;
          const outCount = Object.keys(custom.compound.blocks).filter((k) =>
            k.startsWith("out"),
          ).length;
          newState.blocks[id] = {
            id,
            type: custom.name,
            outputs: new Array(outCount).fill(0),
            compound: custom.compound,
            x: action.x || 200,
            y: action.y || 200,
          };
        }
        break;
      }
      case "ROM_SET_DATA": {
        if (newState.blocks[action.blockId]?.type === "ROM") {
          newState.blocks[action.blockId].romData = action.data;
        }
        break;
      }
      case "MOVE_BLOCK": {
        if (newState.blocks[action.blockId]) {
          newState.blocks[action.blockId].x = action.x;
          newState.blocks[action.blockId].y = action.y;
        }
        break;
      }
      case "REMOVE_BLOCK": {
        const level = LOGIC_LAB_LEVELS.find((l) => l.id === newState.currentLevelId);
        if (
          level?.inputBlocks.some((b) => b.id === action.blockId) ||
          level?.outputBlocks.some((b) => b.id === action.blockId)
        ) {
          break;
        }
        delete newState.blocks[action.blockId];
        newState.connections = newState.connections.filter(
          (c) => c.fromBlockId !== action.blockId && c.toBlockId !== action.blockId,
        );
        break;
      }
      case "CONNECT": {
        newState.connections = newState.connections.filter(
          (c) => !(c.toBlockId === action.toBlockId && c.toPinIndex === action.toPinIndex),
        );
        newState.connections.push({
          fromBlockId: action.fromBlockId,
          fromPinIndex: action.fromPinIndex,
          toBlockId: action.toBlockId,
          toPinIndex: action.toPinIndex,
        });
        break;
      }
      case "DISCONNECT": {
        newState.connections = newState.connections.filter(
          (c) =>
            !(
              c.fromBlockId === action.fromBlockId &&
              c.toBlockId === action.toBlockId &&
              c.toPinIndex === action.toPinIndex
            ),
        );
        break;
      }
      case "CHECK_SOLUTION": {
        const level = LOGIC_LAB_LEVELS.find((l) => l.id === newState.currentLevelId);
        if (level) {
          newState.testResults = level.testCases.map((tc) => {
            const testBlocks = structuredClone(newState.blocks);
            if (tc.initialBlockState) {
              for (const id in tc.initialBlockState) {
                if (testBlocks[id]) Object.assign(testBlocks[id], tc.initialBlockState[id]);
              }
            }

            const cycles = tc.cycles || 1;
            for (let c = 0; c < cycles; c++) {
              if (tc.inputs) {
                for (const id in tc.inputs) {
                  if (testBlocks[id]) {
                    if (id.toLowerCase().includes("clock") || id.toLowerCase().includes("clk")) {
                      testBlocks[id].outputs = [c % 2 === 0 ? 0 : 1];
                    } else {
                      testBlocks[id].outputs = [tc.inputs[id]];
                    }
                  }
                }
              }
              LogicCircuitEngine.simulate(testBlocks, newState.connections);
            }

            if (!tc.outputs) return true;
            return Object.entries(tc.outputs).every(([id, expected]) => {
              const block = testBlocks[id];
              if (!block) return false;
              return block.outputs?.[0] === expected;
            });
          });

          if (newState.testResults.every((r) => r === true)) {
            if (!newState.unlockedLevels.includes(level.id)) {
              newState.unlockedLevels.push(level.id);
              newState.customBlocks[level.id] = {
                name: level.name,
                compound: {
                  blocks: structuredClone(newState.blocks),
                  connections: structuredClone(newState.connections),
                },
              };
            }
          }
        }
        break;
      }
      case "TOGGLE_SWITCH": {
        const block = newState.blocks[action.blockId];
        if (block?.type === "SWITCH") {
          block.outputs = [block.outputs?.[0] === 1 ? 0 : 1];
        }
        break;
      }
      case "RESET": {
        const s = LogicLabRuleset.getInitialState({ levelId: state.currentLevelId });
        s.unlockedLevels = state.unlockedLevels;
        s.customBlocks = state.customBlocks;
        return s;
      }
      case "NEXT_LEVEL": {
        const s = LogicLabRuleset.getInitialState({ levelId: state.currentLevelId + 1 });
        s.unlockedLevels = state.unlockedLevels;
        s.customBlocks = state.customBlocks;
        return s;
      }
    }

    LogicCircuitEngine.simulate(newState.blocks, newState.connections);
    return newState;
  },

  checkWinCondition: (state) => {
    const level = LOGIC_LAB_LEVELS.find((l) => l.id === state.currentLevelId);
    if (!level) return { isFinished: false };

    if (
      state.testResults.length === level.testCases.length &&
      state.testResults.every((r) => r === true)
    ) {
      return { isFinished: true, winnerIds: [], message: "Level Clear!" };
    }
    return { isFinished: false };
  },

  getLegalActions: (_state, _playerId) => [],
};
