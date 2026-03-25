import type { BaseGameState, BaseGameAction, GameRuleset } from "../GameRules";
import type { IGameRNG } from "../utils/IGameRNG";

/**
 * 箱入り娘 (Hakoiri Musume) - Klotski Puzzle Game
 * Grid: 4x5
 */

export type BlockType = "MUSUME" | "HORIZONTAL" | "VERTICAL" | "SMALL";

export interface Block {
  id: string;
  name: string;
  type: BlockType;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface HakoiriMusumeState extends BaseGameState {
  blocks: Block[];
  moveCount: number;
  lastMovedBlockId?: string;
}

export type HakoiriMusumeActionType = "MOVE" | "RESET";

export interface HakoiriMusumeAction extends BaseGameAction {
  type: HakoiriMusumeActionType;
  blockId?: string;
  direction?: "U" | "D" | "L" | "R";
}

const INITIAL_BLOCKS: Block[] = [
  { id: "musume", name: "娘", type: "MUSUME", x: 1, y: 0, width: 2, height: 2 },
  { id: "father", name: "父", type: "VERTICAL", x: 0, y: 0, width: 1, height: 2 },
  { id: "mother", name: "母", type: "VERTICAL", x: 3, y: 0, width: 1, height: 2 },
  { id: "grandfather", name: "爺", type: "VERTICAL", x: 0, y: 2, width: 1, height: 2 },
  { id: "grandmother", name: "婆", type: "VERTICAL", x: 3, y: 2, width: 1, height: 2 },
  { id: "brother", name: "兄弟", type: "HORIZONTAL", x: 1, y: 2, width: 2, height: 1 },
  { id: "child1", name: "子1", type: "SMALL", x: 1, y: 3, width: 1, height: 1 },
  { id: "child2", name: "子2", type: "SMALL", x: 2, y: 3, width: 1, height: 1 },
  { id: "child3", name: "子3", type: "SMALL", x: 0, y: 4, width: 1, height: 1 },
  { id: "child4", name: "子4", type: "SMALL", x: 3, y: 4, width: 1, height: 1 },
];

export const HakoiriMusumeRuleset: GameRuleset<HakoiriMusumeState, HakoiriMusumeAction> = {
  getInitialState: (_options?: any, _rng?: IGameRNG): HakoiriMusumeState => ({
    status: "PLAYING",
    blocks: structuredClone(INITIAL_BLOCKS),
    moveCount: 0,
    players: { "1": null },
    activePlayers: [],
  }),

  isValidAction: (state, action) => {
    if (action.type === "RESET") return true;
    if (state.status !== "PLAYING") return false;
    if (action.type !== "MOVE") return false;
    if (!action.blockId || !action.direction) return false;

    const block = state.blocks.find((b) => b.id === action.blockId);
    if (!block) return false;

    let nextX = block.x;
    let nextY = block.y;

    switch (action.direction) {
      case "U":
        nextY--;
        break;
      case "D":
        nextY++;
        break;
      case "L":
        nextX--;
        break;
      case "R":
        nextX++;
        break;
      default:
        return false;
    }

    // Border check
    if (nextX < 0 || nextY < 0 || nextX + block.width > 4 || nextY + block.height > 5) {
      return false;
    }

    // Collision check
    const otherBlocks = state.blocks.filter((b) => b.id !== block.id);
    for (const other of otherBlocks) {
      if (
        nextX < other.x + other.width &&
        nextX + block.width > other.x &&
        nextY < other.y + other.height &&
        nextY + block.height > other.y
      ) {
        return false;
      }
    }

    return true;
  },

  reduce: (state, action, _rng?: IGameRNG) => {
    if (action.type === "RESET") {
      return {
        ...HakoiriMusumeRuleset.getInitialState(),
        players: state.players,
      };
    }

    const newState = structuredClone(state);
    if (action.type === "MOVE" && action.blockId && action.direction) {
      const blockIndex = newState.blocks.findIndex((b) => b.id === action.blockId);
      if (blockIndex !== -1) {
        const block = newState.blocks[blockIndex];
        switch (action.direction) {
          case "U":
            block.y--;
            break;
          case "D":
            block.y++;
            break;
          case "L":
            block.x--;
            break;
          case "R":
            block.x++;
            break;
        }
        newState.moveCount++;
        newState.lastMovedBlockId = action.blockId;
      }
    }

    return newState;
  },

  checkWinCondition: (state) => {
    const musume = state.blocks.find((b) => b.id === "musume");
    if (musume && musume.x === 1 && musume.y === 3) {
      const winnerId = state.players?.[1] || "Player 1";
      return {
        isFinished: true,
        winnerIds: [winnerId],
        message: `Clear in ${state.moveCount} moves!`,
      };
    }
    return { isFinished: false };
  },

  applyWinResult: (state, winResult) => ({
    ...state,
    status: "FINISHED",
    message: winResult.message,
    activePlayers: [],
  }),

  getLegalActions: (state, playerId) => {
    if (state.status !== "PLAYING") return [];

    const actions: HakoiriMusumeAction[] = [];
    const directions: ("U" | "D" | "L" | "R")[] = ["U", "D", "L", "R"];

    for (const block of state.blocks) {
      for (const dir of directions) {
        const action: HakoiriMusumeAction = {
          type: "MOVE",
          blockId: block.id,
          direction: dir,
          playerId,
        };
        if (HakoiriMusumeRuleset.isValidAction(state, action)) {
          actions.push(action);
        }
      }
    }

    return actions;
  },
};
