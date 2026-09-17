// packages/shared/rules/mahjong/MahjongMatchRuleset.ts
//
// リーチ麻雀の対局（東風戦・半荘戦）。各局は MahjongRuleset をサブゲームとして進め、
// 親の連荘・本場・供託・トビ・オーラスの親の和了止め（アガリ止め）・最終順位を管理する。
import type { BaseGameAction, BaseGameState, GameRuleset } from "../../GameRules";
import type { IGameRNG } from "../../utils/IGameRNG";
import {
  applySubGameAction,
  createSubGame,
  isValidSubGameAction,
  subGameLegalActions,
  type SubGameEntry,
} from "../MetaGameRuleset";
import { WINDS, type MahjongHandResult, type MahjongState, type Wind } from "./MahjongRuleset";

export type MahjongMatchMode = "TONPU" | "HANCHAN";

export interface MahjongMatchState extends BaseGameState {
  playerIds: string[];
  mode: MahjongMatchMode;
  currentGameId: string;
  currentGame: SubGameEntry;
  completedGames: number;
  wind: Wind; // 場風
  round: number; // 局（1-4）
  dealerIndex: number;
  honba: number;
  riichiSticks: number;
  scores: Record<string, number>;
  ranking: string[];
  /** 直前に終わった局の結果 */
  lastResult?: MahjongHandResult;
}

export interface MahjongMatchAction extends BaseGameAction {
  type: "SUBGAME_ACTION";
  subAction: BaseGameAction;
}

export interface MahjongMatchOptions {
  // エンジンのシード（serverSeed / clientSeed）などもこのオブジェクトで渡される
  [key: string]: unknown;
  playerIds?: string[];
  players?: Record<string, string | null>;
  mode?: MahjongMatchMode;
  initialScores?: Record<string, number>;
  akaDora?: boolean;
}

const INITIAL_SCORE = 25_000;

function playerIdsFrom(options: MahjongMatchOptions): string[] {
  const ids =
    options.playerIds ?? Object.values(options.players ?? {}).filter((id): id is string => !!id);
  return ids.length > 0 ? ids : ["player1", "player2", "player3", "player4"];
}

/** 同点は起家に近い順 */
function ranking(scores: Record<string, number>, playerIds: string[]): string[] {
  return [...playerIds].sort(
    (a, b) => scores[b]! - scores[a]! || playerIds.indexOf(a) - playerIds.indexOf(b),
  );
}

/** 最後の場風（東風戦は東、半荘戦は南） */
function finalWind(mode: MahjongMatchMode): Wind {
  return mode === "TONPU" ? "EAST" : "SOUTH";
}

function isLastHand(state: MahjongMatchState): boolean {
  return state.wind === finalWind(state.mode) && state.round === 4;
}

type HandSetup = Pick<
  MahjongMatchState,
  "playerIds" | "scores" | "wind" | "round" | "dealerIndex" | "honba" | "riichiSticks"
>;

function createMahjongGame(
  setup: HandSetup,
  akaDora: boolean | undefined,
  rng?: IGameRNG,
): SubGameEntry {
  return createSubGame("mahjong", setup.playerIds, rng, {
    playerIds: setup.playerIds,
    initialScores: setup.scores,
    wind: setup.wind,
    round: setup.round,
    dealerIndex: setup.dealerIndex,
    honba: setup.honba,
    riichiSticks: setup.riichiSticks,
    akaDora,
  });
}

/** 外側のアクションの playerId とタイムスタンプ（締切の基準）をサブアクションへ引き継ぐ */
function toSubAction(action: MahjongMatchAction): BaseGameAction {
  return {
    ...action.subAction,
    playerId: action.playerId,
    timestamp: action.subAction.timestamp ?? action.timestamp,
  };
}

function allPlayers(playerIds: string[]): Record<string, string | null> {
  return Object.fromEntries(playerIds.map((id, index) => [String(index), id]));
}

function handLabel(state: Pick<MahjongMatchState, "wind" | "round" | "honba">): string {
  const windName = { EAST: "東", SOUTH: "南", WEST: "西", NORTH: "北" }[state.wind];
  return `${windName}${state.round}局${state.honba > 0 ? ` ${state.honba}本場` : ""}`;
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
    const setup: HandSetup = {
      playerIds,
      scores,
      wind: "EAST",
      round: 1,
      dealerIndex: 0,
      honba: 0,
      riichiSticks: 0,
    };
    const currentGame = createMahjongGame(setup, options.akaDora, rng);
    return {
      status: "PLAYING",
      players: allPlayers(playerIds),
      ...setup,
      mode: options.mode ?? "HANCHAN",
      currentGameId: "hand-1",
      currentGame,
      completedGames: 0,
      ranking: ranking(scores, playerIds),
      activePlayers: currentGame.state.activePlayers,
      message: `Mahjong match started. ${handLabel(setup)}`,
    };
  },

  isValidAction: (state, action) => {
    if (state.status !== "PLAYING" || action.type !== "SUBGAME_ACTION") return false;
    return isValidSubGameAction(state.currentGame, toSubAction(action));
  },

  reduce: (state, action, rng) => {
    if (action.type !== "SUBGAME_ACTION") return state;
    const updated = applySubGameAction(state.currentGame, toSubAction(action), rng);
    if (!updated.result) {
      return {
        ...state,
        currentGame: updated,
        activePlayers: updated.state.activePlayers,
        turnDeadline: updated.state.turnDeadline,
      };
    }

    // 局の精算（本場・供託を含む）は MahjongRuleset が済ませている
    const hand = updated.state as MahjongState;
    const result = hand.result;
    const scores = { ...state.scores, ...hand.scores };
    const completedGames = state.completedGames + 1;
    const renchan = result?.renchan ?? false;
    const dealerId = state.playerIds[state.dealerIndex]!;
    const currentRanking = ranking(scores, state.playerIds);

    // 終了条件: トビ / 最終局で親が流れる / オーラスで親が続投かつトップ（アガリ止め・テンパイ止め）
    const busted = state.playerIds.some((id) => scores[id]! < 0);
    const finished = busted || (isLastHand(state) && (!renchan || currentRanking[0] === dealerId));
    if (finished) {
      // 残った供託はトップに渡す
      const finalScores = { ...scores };
      finalScores[currentRanking[0]!]! += hand.riichiSticks * 1_000;
      const finalRanking = ranking(finalScores, state.playerIds);
      return {
        ...state,
        status: "FINISHED",
        currentGame: updated,
        completedGames,
        riichiSticks: 0,
        scores: finalScores,
        ranking: finalRanking,
        lastResult: result,
        activePlayers: [],
        turnDeadline: undefined,
        message: `Mahjong ${state.mode} finished. Winner: ${finalRanking[0]}.`,
      };
    }

    // 連荘なら親は続投して本場が増える。流局で親が流れても本場は積む。子の和了で 0 本場に戻る
    const honba = renchan || result?.type !== "WIN" ? state.honba + 1 : 0;
    let wind = state.wind;
    let round = state.round;
    let dealerIndex = state.dealerIndex;
    if (!renchan) {
      dealerIndex = (state.dealerIndex + 1) % state.playerIds.length;
      round = state.round + 1;
      if (round > 4) {
        round = 1;
        wind = WINDS[(WINDS.indexOf(state.wind) + 1) % WINDS.length]!;
      }
    }
    const next: HandSetup = {
      playerIds: state.playerIds,
      scores,
      wind,
      round,
      dealerIndex,
      honba,
      riichiSticks: hand.riichiSticks,
    };
    const nextGame = createMahjongGame(next, hand.akaDora, rng);
    return {
      ...state,
      ...next,
      currentGameId: `hand-${completedGames + 1}`,
      currentGame: nextGame,
      completedGames,
      ranking: currentRanking,
      lastResult: result,
      activePlayers: nextGame.state.activePlayers,
      turnDeadline: nextGame.state.turnDeadline,
      message: `${hand.message ?? "Hand finished."} Next: ${handLabel(next)}.`,
    };
  },

  checkWinCondition: (state) => ({
    isFinished: state.status === "FINISHED",
    winnerIds: state.status === "FINISHED" ? [state.ranking[0]!].filter(Boolean) : undefined,
    message: state.message,
  }),

  getTimeoutAction: (state, playerId) => {
    const hand = state.currentGame.state as MahjongState;
    if (hand.phase !== "INTERRUPTING" || !hand.activePlayers?.includes(playerId)) return null;
    return { type: "SUBGAME_ACTION", playerId, subAction: { type: "PASS", playerId } };
  },

  getLegalActions: (state, playerId) =>
    subGameLegalActions(state.currentGame, playerId).map((subAction) => ({
      type: "SUBGAME_ACTION",
      playerId,
      subAction,
    })),
};
