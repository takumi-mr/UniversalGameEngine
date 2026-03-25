import type { BaseGameState, GameRuleset } from "../GameRules";
import type { IGameRNG } from "../utils/IGameRNG";
import {
  LogicCircuitEngine,
  type LogicBlockType,
  type LogicBlock,
  type Connection,
} from "../utils/LogicCircuitEngine";

export interface LogicCircuitState extends BaseGameState {
  blocks: Record<string, LogicBlock>;
  connections: Connection[];
}

export type LogicCircuitAction =
  | { type: "ADD_BLOCK"; gateType: LogicBlockType; x?: number; y?: number }
  | { type: "REMOVE_BLOCK"; blockId: string }
  | { type: "MOVE_BLOCK"; blockId: string; x: number; y: number }
  | {
      type: "CONNECT";
      fromBlockId: string;
      fromPinIndex: number;
      toBlockId: string;
      toPinIndex: number;
    }
  | {
      type: "DISCONNECT";
      fromBlockId: string;
      fromPinIndex: number;
      toBlockId: string;
      toPinIndex: number;
    }
  | { type: "TOGGLE_SWITCH"; blockId: string }
  | { type: "RESET" };

export const LogicCircuitRuleset: GameRuleset<LogicCircuitState, any> = {
  getInitialState: (_options?: any, _rng?: IGameRNG): LogicCircuitState => {
    return {
      status: "PLAYING",
      blocks: {},
      connections: [],
      activePlayers: [],
    };
  },

  isValidAction: (state, _action) => {
    if (state.status !== "PLAYING") return false;
    return true;
  },

  reduce: (state, action, _rng?: IGameRNG) => {
    const newState = structuredClone(state);

    switch (action.type) {
      case "ADD_BLOCK": {
        const id = `block_${Math.random().toString(36).substr(2, 9)}`;
        newState.blocks[id] = {
          id,
          type: action.gateType,
          outputs: [0],
          x: action.x || 100,
          y: action.y || 100,
        };
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
        delete newState.blocks[action.blockId];
        newState.connections = newState.connections.filter(
          (c) => c.fromBlockId !== action.blockId && c.toBlockId !== action.blockId,
        );
        break;
      }
      case "CONNECT": {
        // Remove existing connection to same input pin
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
              c.fromPinIndex === action.fromPinIndex &&
              c.toBlockId === action.toBlockId &&
              c.toPinIndex === action.toPinIndex
            ),
        );
        break;
      }
      case "TOGGLE_SWITCH": {
        const block = newState.blocks[action.blockId];
        if (block?.type === "SWITCH") {
          block.outputs = [block.outputs?.[0] === 1 ? 0 : 1];
        }
        break;
      }
      case "RESET":
        return LogicCircuitRuleset.getInitialState();
    }

    // Run simulation
    LogicCircuitEngine.simulate(newState.blocks, newState.connections);

    return newState;
  },

  checkWinCondition: (_state) => ({ isFinished: false }),
  getLegalActions: (_state, _playerId) => [],
};
