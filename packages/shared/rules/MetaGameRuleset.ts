// packages/shared/rules/MetaGameRuleset.ts
//
// 他のルールセットを「サブゲーム」として入れ子に持つための共通部品と、汎用のメタゲーム。
// サブゲームのルールセットは subGameResolver（GameRegistry が登録する）で type 名から解決する。
//
// - createSubGame:   サブゲームを生成し、指定プレイヤーを着席させて開始状態にする
// - applySubGameAction: サブゲームへアクションを委譲し、終局していれば結果を返す
// - subGameLegalActions / isValidSubGameAction: 合法手と検証の委譲
//
// マスク（Secret）とリプレイは何もしなくても入れ子のまま機能する（autoMask は再帰、rng は共有）。
import type { BaseGameState, BaseGameAction, GameRuleset, GameResult } from "../GameRules";
import type { IGameRNG } from "../utils/IGameRNG";
import { resolveSubGame } from "./subGameResolver";

export interface SubGameEntry {
  type: string;
  state: BaseGameState;
  // ルールセットそのものはシリアライズ性を保つため State には保存せず、都度 resolver から取得する
  result?: GameResult; // 終局後に確定した結果
}

/** サブゲームを生成し、プレイヤーを空席に順に着席させ、開始する */
export function createSubGame(
  type: string,
  playerIds: string[],
  rng?: IGameRNG,
  options: Record<string, unknown> = {},
): SubGameEntry {
  const def = resolveSubGame(type);
  if (!def) throw new Error(`Unknown sub-game type: ${type}`);
  const ruleset = def.ruleset as GameRuleset<BaseGameState, BaseGameAction>;

  let state = ruleset.getInitialState(options, rng);

  // 着席（エンジンの組み込み JOIN と同じく空席に順番に座らせる）
  if (state.players) {
    const players = { ...state.players };
    const seats = Object.keys(players).filter((k) => players[k] === null);
    playerIds.forEach((pid, i) => {
      if (seats[i] !== undefined) players[seats[i]] = pid;
    });
    state = { ...state, players };
  }

  // 開始（ルールセットが START を扱えばそれを使い、扱わなければ PLAYING にする）
  const start = { type: "START", playerId: playerIds[0] } as BaseGameAction;
  if (state.status === "WAITING" && ruleset.isValidAction(state, start)) {
    state = ruleset.reduce(state, start, rng);
  }
  if (state.status === "WAITING") state = { ...state, status: "PLAYING" };

  // 手番が未設定なら、合法手を持つ着席者を手番にする
  if (!state.activePlayers?.length) {
    const active = playerIds.filter((pid) => ruleset.getLegalActions(state, pid).length > 0);
    state = { ...state, activePlayers: active };
  }
  return { type, state };
}

function rulesetOf(entry: SubGameEntry): GameRuleset<BaseGameState, BaseGameAction> {
  const def = resolveSubGame(entry.type);
  if (!def) throw new Error(`Unknown sub-game type: ${entry.type}`);
  return def.ruleset;
}

export function isValidSubGameAction(entry: SubGameEntry, action: BaseGameAction): boolean {
  if (entry.state.status !== "PLAYING") return false;
  return rulesetOf(entry).isValidAction(entry.state, action);
}

export function subGameLegalActions(entry: SubGameEntry, playerId: string): BaseGameAction[] {
  if (entry.state.status !== "PLAYING") return [];
  return rulesetOf(entry).getLegalActions(entry.state, playerId);
}

/** サブゲームにアクションを適用し、終局していれば result を確定させた新しいエントリを返す */
export function applySubGameAction(
  entry: SubGameEntry,
  action: BaseGameAction,
  rng?: IGameRNG,
): SubGameEntry {
  const ruleset = rulesetOf(entry);
  let state = ruleset.reduce(entry.state, action, rng);
  const result = ruleset.checkWinCondition(state);
  if (!result.isFinished) return { ...entry, state };

  state = ruleset.applyWinResult
    ? ruleset.applyWinResult(state, result)
    : { ...state, status: "FINISHED", message: result.message };
  return { ...entry, state: { ...state, status: "FINISHED" }, result };
}

// ==========================================
// 汎用メタゲーム: サブゲームの勝利数を競う
// ==========================================

export interface MetaGameState extends BaseGameState {
  subGames: Record<string, SubGameEntry>;
  metaScores: Record<string, number>; // playerId -> 勝利数
  targetScore: number;
}

export interface MetaGameAction extends BaseGameAction {
  type: "SUBGAME_ACTION";
  subGameId: string;
  subAction: BaseGameAction;
}

/** 進行中のサブゲームの手番を集約する */
export function collectActivePlayers(subGames: Record<string, SubGameEntry>): string[] {
  const active = new Set<string>();
  for (const entry of Object.values(subGames)) {
    if (entry.state.status !== "PLAYING") continue;
    for (const pid of entry.state.activePlayers ?? []) active.add(pid);
  }
  return [...active];
}

export const MetaGameRuleset: GameRuleset<MetaGameState, MetaGameAction, any> = {
  getInitialState: (options?: any, rng?: IGameRNG): MetaGameState => {
    const players: Record<string, string | null> = options?.players ?? {};
    const playerIds = Object.values(players).filter((p): p is string => typeof p === "string");
    const subGames: Record<string, SubGameEntry> = {};

    for (const config of options?.initialSubGames ?? []) {
      subGames[config.id] = createSubGame(
        config.type,
        config.playerIds ?? playerIds,
        rng,
        config.options,
      );
    }

    return {
      status: "PLAYING",
      players,
      activePlayers: collectActivePlayers(subGames),
      subGames,
      metaScores: Object.fromEntries(playerIds.map((p) => [p, 0])),
      targetScore: options?.targetScore ?? 3,
      message: "Meta-Game Started",
    };
  },

  isValidAction: (state, action) => {
    if (state.status !== "PLAYING") return false;
    if (action.type !== "SUBGAME_ACTION" || !action.subGameId || !action.subAction) return false;
    const entry = state.subGames[action.subGameId];
    if (!entry) return false;
    return isValidSubGameAction(entry, { ...action.subAction, playerId: action.playerId });
  },

  reduce: (state, action, rng?: IGameRNG) => {
    const entry = state.subGames[action.subGameId];
    if (!entry) return state;

    const updated = applySubGameAction(
      entry,
      { ...action.subAction, playerId: action.playerId },
      rng,
    );
    const subGames = { ...state.subGames, [action.subGameId]: updated };
    const metaScores = { ...state.metaScores };
    let message = state.message;

    if (updated.result) {
      for (const winnerId of updated.result.winnerIds ?? []) {
        metaScores[winnerId] = (metaScores[winnerId] ?? 0) + 1;
      }
      message = `Sub-game ${action.subGameId} finished. ${updated.result.message ?? ""}`.trim();
    }

    return {
      ...state,
      subGames,
      metaScores,
      message,
      activePlayers: collectActivePlayers(subGames),
    };
  },

  checkWinCondition: (state) => {
    for (const [playerId, score] of Object.entries(state.metaScores)) {
      if (score >= state.targetScore) {
        return {
          isFinished: true,
          winnerIds: [playerId],
          message: `Player ${playerId} won the Meta-Game by reaching score ${state.targetScore}!`,
        };
      }
    }

    const ids = Object.keys(state.subGames);
    const allFinished =
      ids.length > 0 && ids.every((id) => state.subGames[id].state.status === "FINISHED");
    if (!allFinished) return { isFinished: false };

    const best = Math.max(...Object.values(state.metaScores), 0);
    const winners = Object.keys(state.metaScores).filter((p) => state.metaScores[p] === best);
    return {
      isFinished: true,
      winnerIds: winners,
      message: "Meta-Game Finished as all sub-games completed.",
    };
  },

  getLegalActions: (state, playerId) => {
    const actions: MetaGameAction[] = [];
    for (const [subGameId, entry] of Object.entries(state.subGames)) {
      for (const subAction of subGameLegalActions(entry, playerId)) {
        actions.push({ type: "SUBGAME_ACTION", playerId, subGameId, subAction });
      }
    }
    return actions;
  },
};
