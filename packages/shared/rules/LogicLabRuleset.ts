import type { BaseGameState, GameRuleset } from "../GameRules";
import type { IGameRNG } from "../utils/IGameRNG";
import {
  LogicCircuitEngine,
  type GateType,
  type LogicBlock,
  type Connection,
  type SubCircuit,
} from "../utils/LogicCircuitEngine";

export interface TestCase {
  inputs: Record<string, number>; // blockId -> value
  outputs: Record<string, number>; // blockId -> value
}

export interface LogicLabLevel {
  id: number;
  name: string;
  description: string;
  allowedGates: GateType[];
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
  | { type: "ADD_BLOCK"; gateType: GateType; x?: number; y?: number }
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
      { id: "in4", label: "S0" }, // Operation select
      { id: "in5", label: "S1" },
    ],
    outputBlocks: [
      { id: "out1", label: "Result" },
      { id: "out2", label: "Cout" },
    ],
    testCases: [
      // Op 00 (AND): A & B
      { inputs: { in1: 1, in2: 0, in3: 0, in4: 0, in5: 0 }, outputs: { out1: 0 } },
      { inputs: { in1: 1, in2: 1, in3: 0, in4: 0, in5: 0 }, outputs: { out1: 1 } },
      // Op 01 (OR): A | B
      { inputs: { in1: 1, in2: 0, in3: 0, in4: 1, in5: 0 }, outputs: { out1: 1 } },
      // Op 10 (ADD): A + B + Cin
      { inputs: { in1: 1, in2: 1, in3: 1, in4: 0, in5: 1 }, outputs: { out1: 1, out2: 1 } },
    ],
  },
];

export const LogicLabRuleset: GameRuleset<LogicLabState, any> = {
  getInitialState: (options?: { levelId?: number }, _rng?: IGameRNG): LogicLabState => {
    const levelId = options?.levelId || 1;
    const level = LOGIC_LAB_LEVELS.find((l) => l.id === levelId) || LOGIC_LAB_LEVELS[0];

    const blocks: Record<string, LogicBlock> = {};
    level.inputBlocks.forEach((ib, idx) => {
      blocks[ib.id] = { id: ib.id, type: "SWITCH", outputs: [0], x: 50, y: 100 + idx * 80 };
    });
    level.outputBlocks.forEach((ob, idx) => {
      blocks[ob.id] = { id: ob.id, type: "LED", outputs: [0], x: 600, y: 100 + idx * 80 };
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

  isValidAction: (state, action) => {
    if (state.status !== "PLAYING" && action.type !== "RESET") return false;
    return true;
  },

  reduce: (state, action, _rng?: IGameRNG) => {
    const newState = structuredClone(state);

    switch (action.type) {
      case "ADD_BLOCK": {
        const level = LOGIC_LAB_LEVELS.find((l) => l.id === newState.currentLevelId);
        if (level && level.allowedGates.includes(action.gateType)) {
          const id = `block_${Math.random().toString(36).substr(2, 9)}`;
          newState.blocks[id] = {
            id,
            type: action.gateType,
            outputs: [0],
            x: action.x || 200,
            y: action.y || 200,
          };
        }
        break;
      }
      case "ADD_CUSTOM_BLOCK": {
        const custom = newState.customBlocks[action.levelId];
        if (custom) {
          const id = `custom_${action.levelId}_${Math.random().toString(36).substr(2, 9)}`;
          newState.blocks[id] = {
            id,
            type: custom.name,
            outputs: [],
            compound: custom.compound,
            x: action.x || 200,
            y: action.y || 200,
          };
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
            for (const id in tc.inputs) {
              if (testBlocks[id]) testBlocks[id].outputs = [tc.inputs[id]];
            }
            LogicCircuitEngine.simulate(testBlocks, newState.connections);
            return Object.entries(tc.outputs).every(
              ([id, val]) => testBlocks[id]?.outputs?.[0] === val,
            );
          });

          if (newState.testResults.every((r) => r === true)) {
            // Unlock custom block
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
      return {
        isFinished: true,
        winnerIds: [],
        message: "Level Clear!",
      };
    }
    return { isFinished: false };
  },

  getLegalActions: (_state, _playerId) => [],
};
