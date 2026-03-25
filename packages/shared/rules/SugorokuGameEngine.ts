import type { BaseGameState } from "../GameRules";

export interface BoardSpace<TState extends BaseGameState> {
  id: string;
  type: string;
  text: string;
  /**
   * Called when a player stops on this space.
   */
  onStop?: (state: TState, playerId: string) => TState;
  /**
   * Called when a player passes this space (moving past it).
   */
  onPass?: (state: TState, playerId: string) => TState;
  /**
   * If true, the player MUST stop here even if they have more moves left.
   */
  mustStop?: boolean;
}

export interface Board<TState extends BaseGameState> {
  spaces: BoardSpace<TState>[];
  // Helper to find the next space. For simple linear boards, it's just index + 1.
  getNextSpaceId: (currentSpaceId: string, state: TState) => string | null;
}

export interface BaseBoardPlayer {
  id: string;
  position: string; // Space ID
  isFinished: boolean;
}

export interface BaseBoardState extends BaseGameState {
  boardPlayers: Record<string, BaseBoardPlayer>;
  turnOrder: string[];
  currentPlayerIndex: number;
}

/**
 * Handles movement logic for a board game.
 */
export function movePlayer<TState extends BaseBoardState>(
  state: TState,
  playerId: string,
  steps: number,
  board: Board<TState>,
): TState {
  let currentState = JSON.parse(JSON.stringify(state)) as TState;
  let player = currentState.boardPlayers[playerId];
  let currentSpaceId = player.position;

  for (let i = 0; i < steps; i++) {
    const nextSpaceId = board.getNextSpaceId(currentSpaceId, currentState);
    if (!nextSpaceId) {
      break;
    }

    currentSpaceId = nextSpaceId;
    const space = board.spaces.find((s) => s.id === currentSpaceId);

    // Apply onPass effect
    if (space?.onPass) {
      currentState = space.onPass(currentState, playerId);
      // Re-get player in case onPass replaced the state
      player = currentState.boardPlayers[playerId];
    }

    // Check if must stop
    if (space?.mustStop) {
      break;
    }
  }

  // Update position
  player.position = currentSpaceId;
  const finalSpace = board.spaces.find((s) => s.id === currentSpaceId);

  // Apply onStop effect
  if (finalSpace?.onStop) {
    currentState = finalSpace.onStop(currentState, playerId);
    player = currentState.boardPlayers[playerId];
  }

  // If the space is the end (no next space), mark as finished
  if (!board.getNextSpaceId(currentSpaceId, currentState)) {
    player.isFinished = true;
  }

  return currentState;
}

/**
 * Progresses to the next player's turn, skipping finished players.
 */
export function nextTurn<TState extends BaseBoardState>(state: TState): TState {
  const newState = { ...state };
  const numPlayers = newState.turnOrder.length;

  for (let i = 0; i < numPlayers; i++) {
    newState.currentPlayerIndex = (newState.currentPlayerIndex + 1) % numPlayers;
    const nextPlayerId = newState.turnOrder[newState.currentPlayerIndex];
    if (!newState.boardPlayers[nextPlayerId].isFinished) {
      newState.activePlayers = [nextPlayerId];
      return newState;
    }
  }

  // All players finished
  newState.activePlayers = [];
  newState.status = "FINISHED";
  return newState;
}
