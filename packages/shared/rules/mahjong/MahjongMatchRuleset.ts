import type { BaseGameAction, BaseGameState, GameResult, GameRuleset } from "../../GameRules";
import type { IGameRNG } from "../../utils/IGameRNG";
import {
  applySubGameAction,
  createSubGame,
  isValidSubGameAction,
  subGameLegalActions,
  type SubGameEntry,
} from "../MetaGameRuleset";
import type { MahjongState } from "./MahjongRuleset";

export type MahjongMatchMode = "TONPU" | "HANCHAN";

export interface MahjongMatchState extends BaseGameState {
  playerIds: string[];
  mode: MahjongMatchMode;
  currentGameId: string;
  currentGame: SubGameEntry;
  completedGames: number;
  dealerIndex: number;
  honba: number;
  riichiSticks: number;
  scores: Record<string, number>;
  ranking: string[];
}

export interface MahjongMatchAction extends BaseGameAction {
  type: "SUBGAME_ACTION";
  subAction: BaseGameAction;
}

interface MahjongMatchOptions {
  playerIds?: string[];
  players?: Record<string, string | null>;
  mode?: MahjongMatchMode;
  initialScores?: Record<string, number>;
}

const INITIAL_SCORE = 25_000;

function playerIdsFrom(options: MahjongMatchOptions): string[] {
  const ids =
    options.playerIds ?? Object.values(options.players ?? {}).filter((id): id is string => !!id);
  return ids.length > 0 ? ids : ["player1", "player2", "player3", "player4"];
}

function ranking(scores: Record<string, number>, playerIds: string[]): string[] {
  return [...playerIds].sort(
    (a, b) => scores[b] - scores[a] || playerIds.indexOf(a) - playerIds.indexOf(b),
  );
}

function maxGames(mode: MahjongMatchMode): number {
  return mode === "TONPU" ? 4 : 8;
}

function windForGame(gameNumber: number): "EAST" | "SOUTH" {
  return gameNumber <= 4 ? "EAST" : "SOUTH";
}

function createMahjongGame(
  playerIds: string[],
  scores: Record<string, number>,
  gameNumber: number,
  rng?: IGameRNG,
): SubGameEntry {
  return createSubGame("mahjong", playerIds, rng, {
    playerIds,
    initialScores: scores,
    wind: windForGame(gameNumber),
    round: ((gameNumber - 1) % 4) + 1,
  });
}

function allPlayers(state: MahjongMatchState): Record<string, string | null> {
  return Object.fromEntries(state.playerIds.map((id, index) => [String(index), id]));
}

function isDealerWinner(state: MahjongMatchState, result: GameResult): boolean {
  return (result.winnerIds ?? []).includes(state.playerIds[state.dealerIndex] ?? "");
}

function isMatchFinished(state: MahjongMatchState, result: GameResult): boolean {
  if (state.completedGames >= maxGames(state.mode)) return true;
  if ((result.winnerIds ?? []).some((id) => state.scores[id] < 0)) return true;
  return false;
}

function nextDealerAndHonba(
  state: MahjongMatchState,
  result: GameResult,
): { dealerIndex: number; honba: number } {
  const dealerWon = isDealerWinner(state, result);
  const draw = (result.winnerIds ?? []).length === 0;
  if (dealerWon || draw) {
    return { dealerIndex: state.dealerIndex, honba: state.honba + 1 };
  }
  return {
    dealerIndex: (state.dealerIndex + 1) % state.playerIds.length,
    honba: 0,
  };
}

export const MahjongMatchRuleset: GameRuleset<
  MahjongMatchState,
  MahjongMatchAction,
  MahjongMatchOptions
> = {
  getInitialState: (options = {}, rng) => {
    const playerIds = playerIdsFrom(options);
    if (playerIds.length !== 4) {
      throw new Error("Mahjong match requires exactly four players.");
    }
    const scores = Object.fromEntries(
      playerIds.map((id) => [id, options.initialScores?.[id] ?? INITIAL_SCORE]),
    );
    const currentGame = createMahjongGame(playerIds, scores, 1, rng);
    return {
      status: "PLAYING",
      players: allPlayers({ playerIds } as MahjongMatchState),
      playerIds,
      mode: options.mode ?? "HANCHAN",
      currentGameId: "hand-1",
      currentGame,
      completedGames: 0,
      dealerIndex: 0,
      honba: 0,
      riichiSticks: 0,
      scores,
      ranking: ranking(scores, playerIds),
      activePlayers: currentGame.state.activePlayers,
      message: "Mahjong match started.",
    };
  },

  isValidAction: (state, action) => {
    if (state.status !== "PLAYING" || action.type !== "SUBGAME_ACTION") return false;
    return isValidSubGameAction(state.currentGame, {
      ...action.subAction,
      playerId: action.playerId,
    });
  },

  reduce: (state, action, rng) => {
    if (action.type !== "SUBGAME_ACTION") return state;
    const updated = applySubGameAction(
      state.currentGame,
      {
        ...action.subAction,
        playerId: action.playerId,
      },
      rng,
    );
    if (!updated.result) {
      return {
        ...state,
        currentGame: updated,
        activePlayers: updated.state.activePlayers,
      };
    }

    const handState = updated.state as { scores?: Record<string, number>; riichiSticks?: number };
    const scores = {
      ...state.scores,
      ...(handState.scores ?? {}),
    };
    const winners = updated.result.winnerIds ?? [];
    const handRiichiSticks = handState.riichiSticks ?? state.riichiSticks;
    if (winners.length > 0 && handRiichiSticks > 0) {
      const award = handRiichiSticks * 1_000;
      scores[winners[0]!] = (scores[winners[0]!] ?? 0) + award;
    }
    const riichiSticks = winners.length > 0 ? 0 : handRiichiSticks;
    const completedGames = state.completedGames + 1;
    const finished = isMatchFinished({ ...state, scores, completedGames }, updated.result);
    if (finished) {
      const finalRanking = ranking(scores, state.playerIds);
      return {
        ...state,
        status: "FINISHED",
        currentGame: updated,
        completedGames,
        scores,
        riichiSticks,
        ranking: finalRanking,
        activePlayers: [],
        message: `Mahjong ${state.mode} finished. Winner: ${finalRanking[0]}.`,
      };
    }

    const next = nextDealerAndHonba(state, updated.result);
    const nextGame = createMahjongGame(state.playerIds, scores, completedGames + 1, rng);
    return {
      ...state,
      currentGameId: `hand-${completedGames + 1}`,
      currentGame: nextGame,
      completedGames,
      dealerIndex: next.dealerIndex,
      honba: next.honba,
      scores,
      riichiSticks,
      ranking: ranking(scores, state.playerIds),
      activePlayers: nextGame.state.activePlayers,
      message: `Hand ${completedGames} finished. Next: hand ${completedGames + 1}.`,
    };
  },

  checkWinCondition: (state) => ({
    isFinished: state.status === "FINISHED",
    winnerIds: state.status === "FINISHED" ? [state.ranking[0]!].filter(Boolean) : undefined,
    message: state.message,
  }),

  getTimeoutAction: (state, playerId) => {
    const subAction =
      (state.currentGame.state as MahjongState).phase === "INTERRUPTING"
        ? { type: "PASS", playerId }
        : null;
    return subAction ? { type: "SUBGAME_ACTION", playerId, subAction } : null;
  },

  getLegalActions: (state, playerId) =>
    subGameLegalActions(state.currentGame, playerId).map((subAction) => ({
      type: "SUBGAME_ACTION",
      playerId,
      subAction,
    })),
};
