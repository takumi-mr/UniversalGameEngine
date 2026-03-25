import type { BaseGameState, BaseGameAction, GameRuleset } from "../GameRules";
import type { IGameRNG } from "../utils/IGameRNG";

export interface TowerOfHanoiState extends BaseGameState {
  towers: number[][]; // [tower0, tower1, tower2], each containing disk sizes (e.g. [5, 4, 3])
  moves: number;
  diskCount: number;
}

export type TowerOfHanoiActionType = "MOVE" | "RESET";

export interface TowerOfHanoiAction extends BaseGameAction {
  type: TowerOfHanoiActionType;
  from?: number; // tower index (0-2)
  to?: number; // tower index (0-2)
  diskCount?: number; // for RESET
}

export const TowerOfHanoiRuleset: GameRuleset<TowerOfHanoiState, TowerOfHanoiAction> = {
  getInitialState: (options?: { diskCount?: number }, _rng?: IGameRNG): TowerOfHanoiState => {
    const diskCount = options?.diskCount || 3;
    const initialTower = Array.from({ length: diskCount }, (_, i) => diskCount - i);
    return {
      status: "PLAYING",
      towers: [initialTower, [], []],
      moves: 0,
      diskCount,
      activePlayers: [], // Single player, no specific active player needed for engine core
    };
  },

  isValidAction: (state, action) => {
    if (action.type === "RESET") return true;
    if (state.status !== "PLAYING") return false;
    if (action.type !== "MOVE") return false;

    const { from, to } = action;
    if (from === undefined || to === undefined) return false;
    if (from < 0 || from > 2 || to < 0 || to > 2) return false;
    if (from === to) return false;

    const fromTower = state.towers[from];
    const toTower = state.towers[to];

    if (fromTower.length === 0) return false;

    const diskToMove = fromTower[fromTower.length - 1];
    if (toTower.length > 0) {
      const topDiskOnTo = toTower[toTower.length - 1];
      if (diskToMove > topDiskOnTo) return false;
    }

    return true;
  },

  reduce: (state, action, _rng?: IGameRNG) => {
    if (action.type === "RESET") {
      return TowerOfHanoiRuleset.getInitialState({
        diskCount: action.diskCount || state.diskCount,
      });
    }

    if (action.type !== "MOVE") return state;
    if (!TowerOfHanoiRuleset.isValidAction(state, action)) return state;

    const { from, to } = action;
    const newState = structuredClone(state);

    const disk = newState.towers[from!].pop()!;
    newState.towers[to!].push(disk);
    newState.moves++;

    return newState;
  },

  checkWinCondition: (state) => {
    // Check if the last tower has all disks
    if (state.towers[2].length === state.diskCount) {
      return {
        isFinished: true,
        winnerIds: state.activePlayers || [],
        message: `Clear! Total moves: ${state.moves}`,
      };
    }
    return { isFinished: false };
  },

  applyWinResult: (state, winResult) => ({
    ...state,
    status: "FINISHED",
    message: winResult.message,
  }),

  getLegalActions: (state, _playerId) => {
    if (state.status !== "PLAYING") return [];

    const actions: TowerOfHanoiAction[] = [];
    for (let from = 0; from < 3; from++) {
      for (let to = 0; to < 3; to++) {
        if (from === to) continue;
        const action: TowerOfHanoiAction = { type: "MOVE", from, to };
        if (TowerOfHanoiRuleset.isValidAction(state, action)) {
          actions.push(action);
        }
      }
    }
    return actions;
  },
};
