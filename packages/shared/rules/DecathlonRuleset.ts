// packages/shared/rules/DecathlonRuleset.ts
//
// 『十種競技』— 登録済みのゲームを「種目」として渡り歩くメタゲーム（2〜4 人）。
//
// 各種目の流れ:
//   INTERLUDE: ScenarioEngine で「幕間イベント」を評価し、この種目の修正（得点 2 倍 / 最下位ボーナス）を決める
//   PICK:      最下位（初回はランダム）が、提示された 3 種目から次の種目を選ぶ（キャッチアップ機構）
//   DECLARE:   出場者が「強気（BOLD）/ 堅実（SAFE）」を秘密で同時に宣言する
//   PLAY:      盤（サブゲーム）を同時進行。2 人用の種目は首位 vs 最下位、2 位 vs 3 位…と組み、
//              余った 1 人は不戦（1 点）。多人数の種目は全員で 1 盤
//   精算:      勝ち 2 / 引き分け 1 / 負け 0。BOLD は勝てば 2 倍、負ければ 0 で相手に +1
//   → 全種目が終わったら合計点が最多の人が勝ち
//
// サブゲームの生成・委譲は MetaGameRuleset の共通部品を使う。
import type { BaseGameState, BaseGameAction, GameRuleset } from "../GameRules";
import { createSecret, type Secret } from "../GameRules";
import type { IGameRNG } from "../utils/IGameRNG";
import { requireRng } from "../utils/requireRng";
import { ScenarioEngine, type ScenarioNode } from "../utils/ScenarioEngine";
import {
  applySubGameAction,
  collectActivePlayers,
  createSubGame,
  isValidSubGameAction,
  subGameLegalActions,
  type SubGameEntry,
} from "./MetaGameRuleset";
import { resolveSubGame } from "./subGameResolver";

// --- 1. 型定義 ---

export type DecathlonPhase = "PICK" | "DECLARE" | "PLAY" | "DONE";
export type Declaration = "BOLD" | "SAFE";
export type EventModifier = "NONE" | "DOUBLE" | "UNDERDOG";

export interface Board {
  id: string; // subGames のキー
  players: string[];
}

export interface EventRecord {
  index: number;
  game: string;
  modifier: EventModifier;
  points: Record<string, number>; // この種目で得た点
}

export interface DecathlonState extends BaseGameState {
  playerIds: string[];
  eventCount: number;
  eventIndex: number; // 0 始まり
  gamePool: string[];
  phase: DecathlonPhase;

  scores: Record<string, number>;
  pickerId: string | null;
  offeredGames: string[];
  currentGame: string | null;
  modifier: EventModifier;
  interludeText: string | null; // 幕間イベントの演出文

  boards: Board[];
  byePlayerId: string | null;
  declarations: Record<string, Secret<Declaration>>;
  revealedDeclarations: Record<string, Declaration> | null;
  subGames: Record<string, SubGameEntry>;

  history: EventRecord[];
  log: string[];
}

export type DecathlonAction = BaseGameAction & {
  type: "JOIN" | "START" | "PICK" | "DECLARE" | "SUBGAME_ACTION";
  gameType?: string; // PICK
  declaration?: Declaration; // DECLARE
  subGameId?: string; // SUBGAME_ACTION
  subAction?: BaseGameAction; // SUBGAME_ACTION
};

// --- 2. 定数 ---

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 4;
export const DEFAULT_EVENT_COUNT = 5;
export const DEFAULT_GAME_POOL = ["tictactoe", "othello", "mancala", "high_low", "cave_dive"];
const OFFER_COUNT = 3;
const WIN_POINTS = 2;
const DRAW_POINTS = 1;
const BYE_POINTS = 1;

/**
 * 幕間イベント。条件ノードを辿って止まったノードが、この種目の修正と演出文になる。
 * 終端は「選択待ち（choices が空の choice ノード）」にして、ScenarioEngine がそこで止まるようにしている
 * （text ノードは自動で next へ進んでしまうため）。
 * flags: eventIndex, eventCount, isFinal, gap（首位と最下位の点差）
 */
export const INTERLUDE_SCENARIO: Record<string, ScenarioNode> = {
  start: { type: "condition", if: "eventIndex === 0", then: "opening", else: "checkFinal" },
  opening: {
    type: "choice",
    text: "十種競技、開幕！ 最初の種目は運命のくじで選ばれた人が決めます。",
    choices: [],
  },
  checkFinal: { type: "condition", if: "isFinal", then: "double", else: "checkGap" },
  double: { type: "choice", text: "最終種目！ 得点はすべて 2 倍です！", choices: [] },
  checkGap: { type: "condition", if: "gap >= 3", then: "underdog", else: "normal" },
  underdog: {
    type: "choice",
    text: "点差が開いてきました。この種目、最下位が勝てばボーナス +1！",
    choices: [],
  },
  normal: { type: "choice", text: "次の種目へ。最下位が種目を選びます。", choices: [] },
};

const MODIFIER_BY_NODE: Record<string, EventModifier> = {
  underdog: "UNDERDOG",
  double: "DOUBLE",
};

// --- 3. ヘルパー ---

const seatedPlayers = (state: BaseGameState): string[] =>
  Object.values(state.players ?? {}).filter((p): p is string => typeof p === "string");

/** 得点順（同点は playerIds 順）で並べる */
function ranking(state: DecathlonState): string[] {
  return [...state.playerIds].sort(
    (a, b) =>
      state.scores[b] - state.scores[a] || state.playerIds.indexOf(a) - state.playerIds.indexOf(b),
  );
}

function pickN<T>(items: T[], n: number, rng?: IGameRNG): T[] {
  const pool = [...items];
  const out: T[] = [];
  while (pool.length > 0 && out.length < n) {
    const i = requireRng(rng, "Decathlon").nextInt(0, pool.length - 1);
    out.push(pool.splice(i, 1)[0]);
  }
  return out;
}

/** 幕間イベントを評価して、修正と演出文を返す */
function runInterlude(state: DecathlonState): { modifier: EventModifier; text: string } {
  const ranked = ranking(state);
  const flags = {
    eventIndex: state.eventIndex,
    eventCount: state.eventCount,
    isFinal: state.eventIndex === state.eventCount - 1,
    gap: state.scores[ranked[0]] - state.scores[ranked[ranked.length - 1]],
  };
  const { nextNodeId } = new ScenarioEngine(INTERLUDE_SCENARIO).step("start", null, flags);
  const node = INTERLUDE_SCENARIO[nextNodeId];
  return {
    modifier: MODIFIER_BY_NODE[nextNodeId] ?? "NONE",
    text: node && "text" in node ? (node.text ?? "") : "",
  };
}

/** 次の種目の準備: 幕間 → 選択者と候補を決めて PICK へ */
function beginEvent(state: DecathlonState, rng?: IGameRNG): DecathlonState {
  const { modifier, text } = runInterlude(state);
  const ranked = ranking(state);
  const pickerId =
    state.eventIndex === 0 ? pickN(state.playerIds, 1, rng)[0] : ranked[ranked.length - 1];
  const offeredGames = pickN(state.gamePool, OFFER_COUNT, rng);

  return {
    ...state,
    phase: "PICK",
    modifier,
    interludeText: text,
    pickerId,
    offeredGames,
    currentGame: null,
    boards: [],
    byePlayerId: null,
    declarations: {},
    revealedDeclarations: null,
    subGames: {},
    activePlayers: [pickerId],
    log: [...state.log, `第 ${state.eventIndex + 1} 種目: ${text}`],
  };
}

/** 種目に合わせて盤の組み合わせを作る（2 人用: 首位 vs 最下位…、多人数用: 全員で 1 盤） */
function makeBoards(
  state: DecathlonState,
  gameType: string,
): { boards: Board[]; bye: string | null } {
  const def = resolveSubGame(gameType);
  const seats = Math.min(def?.maxPlayers ?? 2, state.playerIds.length);
  const ranked = ranking(state);

  if (seats >= state.playerIds.length) {
    return { boards: [{ id: "board1", players: ranked }], bye: null };
  }

  // 2 人用: 上位と下位を組ませる
  const boards: Board[] = [];
  let lo = 0;
  let hi = ranked.length - 1;
  while (lo < hi) {
    boards.push({ id: `board${boards.length + 1}`, players: [ranked[lo], ranked[hi]] });
    lo++;
    hi--;
  }
  return { boards, bye: lo === hi ? ranked[lo] : null };
}

/** 全盤が終わった: 宣言と修正を加味して得点を確定し、次の種目へ（または終了） */
function settleEvent(state: DecathlonState): DecathlonState {
  const points: Record<string, number> = Object.fromEntries(state.playerIds.map((p) => [p, 0]));
  const declared = state.revealedDeclarations ?? {};
  const ranked = ranking(state);
  const lastPlace = ranked[ranked.length - 1];
  const lines: string[] = [];

  for (const board of state.boards) {
    const result = state.subGames[board.id]?.result;
    const winners = result?.winnerIds ?? [];
    const isDraw = winners.length !== 1;

    for (const p of board.players) {
      const won = winners.includes(p);
      let pts = isDraw ? (winners.length === 0 || won ? DRAW_POINTS : 0) : won ? WIN_POINTS : 0;
      if (declared[p] === "BOLD") {
        if (won && !isDraw) pts *= 2;
        else pts = 0;
      }
      if (state.modifier === "UNDERDOG" && p === lastPlace && won && !isDraw) pts += 1;
      points[p] += pts;
    }
    // BOLD で負けた人がいれば、同じ盤の勝者に +1
    if (!isDraw) {
      const boldLosers = board.players.filter(
        (p) => !winners.includes(p) && declared[p] === "BOLD",
      );
      for (const w of winners) points[w] += boldLosers.length;
    }
    lines.push(
      `${board.id}: ${isDraw ? "引き分け" : `${winners[0]} の勝ち`}` +
        board.players.map((p) => ` ${p}${declared[p] === "BOLD" ? "(強気)" : ""}`).join(""),
    );
  }
  if (state.byePlayerId) points[state.byePlayerId] += BYE_POINTS;
  if (state.modifier === "DOUBLE") for (const p of state.playerIds) points[p] *= 2;

  const scores = { ...state.scores };
  for (const p of state.playerIds) scores[p] += points[p];

  const record: EventRecord = {
    index: state.eventIndex,
    game: state.currentGame!,
    modifier: state.modifier,
    points,
  };
  const summary = state.playerIds.map((p) => `${p} +${points[p]}`).join(", ");
  const next: DecathlonState = {
    ...state,
    scores,
    history: [...state.history, record],
    log: [...state.log, ...lines, `得点: ${summary}`],
    eventIndex: state.eventIndex + 1,
  };

  if (next.eventIndex >= next.eventCount) {
    return { ...next, phase: "DONE", activePlayers: [], subGames: {}, boards: [] };
  }
  return next;
}

// --- 4. ルールセット本体 ---

export const DecathlonRuleset: GameRuleset<DecathlonState, DecathlonAction> = {
  getInitialState: (
    options?: { playerIds?: string[]; eventCount?: number; gamePool?: string[] },
    _rng?: IGameRNG,
  ): DecathlonState => {
    const playerIds = (options?.playerIds ?? []).filter(Boolean).slice(0, MAX_PLAYERS);
    const players: Record<string, string | null> = {};
    for (let i = 0; i < MAX_PLAYERS; i++) players[String(i)] = playerIds[i] ?? null;

    return {
      status: "WAITING",
      players,
      activePlayers: [],
      playerIds: [],
      eventCount: options?.eventCount ?? DEFAULT_EVENT_COUNT,
      eventIndex: 0,
      gamePool: options?.gamePool ?? DEFAULT_GAME_POOL,
      phase: "PICK",
      scores: {},
      pickerId: null,
      offeredGames: [],
      currentGame: null,
      modifier: "NONE",
      interludeText: null,
      boards: [],
      byePlayerId: null,
      declarations: {},
      revealedDeclarations: null,
      subGames: {},
      history: [],
      log: [],
    };
  },

  isValidAction: (state, action) => {
    if (action.type === "START") {
      return state.status === "WAITING" && seatedPlayers(state).length >= MIN_PLAYERS;
    }
    if (state.status !== "PLAYING") return false;
    const pId = action.playerId;
    if (!pId || !state.playerIds.includes(pId)) return false;

    switch (action.type) {
      case "PICK":
        return (
          state.phase === "PICK" &&
          state.pickerId === pId &&
          !!action.gameType &&
          state.offeredGames.includes(action.gameType)
        );
      case "DECLARE":
        return (
          state.phase === "DECLARE" &&
          !!state.activePlayers?.includes(pId) &&
          (action.declaration === "BOLD" || action.declaration === "SAFE")
        );
      case "SUBGAME_ACTION": {
        if (state.phase !== "PLAY" || !action.subGameId || !action.subAction) return false;
        const entry = state.subGames[action.subGameId];
        if (!entry) return false;
        const board = state.boards.find((b) => b.id === action.subGameId);
        if (!board?.players.includes(pId)) return false;
        return isValidSubGameAction(entry, { ...action.subAction, playerId: pId });
      }
      default:
        return false;
    }
  },

  reduce: (state, action, rng) => {
    if (action.type === "START") {
      const playerIds = seatedPlayers(state);
      const players: Record<string, string | null> = {};
      for (const [slot, id] of Object.entries(state.players ?? {})) {
        if (id !== null) players[slot] = id;
      }
      // リゾルバで解決できる種目だけをプールにする
      const gamePool = state.gamePool.filter((t) => resolveSubGame(t) !== undefined);
      return beginEvent(
        {
          ...state,
          status: "PLAYING",
          players,
          playerIds,
          gamePool,
          scores: Object.fromEntries(playerIds.map((p) => [p, 0])),
          log: [`参加者: ${playerIds.join(", ")}`],
        },
        rng,
      );
    }

    const pId = action.playerId!;

    if (action.type === "PICK") {
      const gameType = action.gameType!;
      const { boards, bye } = makeBoards(state, gameType);
      const contestants = boards.flatMap((b) => b.players);
      return {
        ...state,
        phase: "DECLARE",
        currentGame: gameType,
        boards,
        byePlayerId: bye,
        declarations: {},
        revealedDeclarations: null,
        activePlayers: contestants,
        log: [
          ...state.log,
          `${pId} が種目に ${resolveSubGame(gameType)?.name ?? gameType} を選択` +
            (bye ? `（${bye} は不戦で +${BYE_POINTS}）` : ""),
        ],
      };
    }

    if (action.type === "DECLARE") {
      const declarations = {
        ...state.declarations,
        [pId]: createSecret(action.declaration!, [pId], "?"),
      };
      const waiting = (state.activePlayers ?? []).filter((p) => !declarations[p]);
      if (waiting.length > 0) return { ...state, declarations, activePlayers: waiting };

      // 全員の宣言が揃った: 公開して盤を開く
      const revealed: Record<string, Declaration> = {};
      for (const [p, s] of Object.entries(declarations)) revealed[p] = s.value;
      const subGames: Record<string, SubGameEntry> = {};
      for (const board of state.boards) {
        subGames[board.id] = createSubGame(state.currentGame!, board.players, rng);
      }
      return {
        ...state,
        phase: "PLAY",
        declarations: {},
        revealedDeclarations: revealed,
        subGames,
        activePlayers: collectActivePlayers(subGames),
        log: [
          ...state.log,
          `宣言: ${Object.entries(revealed)
            .map(([p, d]) => `${p}=${d === "BOLD" ? "強気" : "堅実"}`)
            .join(", ")}`,
        ],
      };
    }

    if (action.type === "SUBGAME_ACTION") {
      const entry = state.subGames[action.subGameId!];
      const updated = applySubGameAction(entry, { ...action.subAction!, playerId: pId }, rng);
      const subGames = { ...state.subGames, [action.subGameId!]: updated };
      const next: DecathlonState = {
        ...state,
        subGames,
        activePlayers: collectActivePlayers(subGames),
      };
      const allDone = state.boards.every((b) => subGames[b.id].state.status === "FINISHED");
      if (!allDone) return next;

      const settled = settleEvent(next);
      return settled.phase === "DONE" ? settled : beginEvent(settled, rng);
    }

    return state;
  },

  checkWinCondition: (state) => {
    if (state.phase !== "DONE") return { isFinished: false };
    const best = Math.max(...state.playerIds.map((p) => state.scores[p]));
    const winnerIds = state.playerIds.filter((p) => state.scores[p] === best);
    const summary = state.playerIds.map((p) => `${p}: ${state.scores[p]}`).join(", ");
    return {
      isFinished: true,
      winnerIds,
      message:
        winnerIds.length > 1
          ? `同点優勝！ ${winnerIds.join(", ")}（${summary}）`
          : `${winnerIds[0]} の総合優勝！（${summary}）`,
    };
  },

  getLegalActions: (state, playerId) => {
    if (state.status === "WAITING") {
      const seated = seatedPlayers(state);
      return seated.length >= MIN_PLAYERS && seated.includes(playerId)
        ? [{ type: "START", playerId }]
        : [];
    }
    if (state.status !== "PLAYING" || !state.playerIds.includes(playerId)) return [];

    switch (state.phase) {
      case "PICK":
        return state.pickerId === playerId
          ? state.offeredGames.map((gameType) => ({ type: "PICK", playerId, gameType }))
          : [];
      case "DECLARE":
        return state.activePlayers?.includes(playerId)
          ? [
              { type: "DECLARE", playerId, declaration: "SAFE" },
              { type: "DECLARE", playerId, declaration: "BOLD" },
            ]
          : [];
      case "PLAY": {
        const actions: DecathlonAction[] = [];
        for (const board of state.boards) {
          if (!board.players.includes(playerId)) continue;
          for (const subAction of subGameLegalActions(state.subGames[board.id], playerId)) {
            actions.push({ type: "SUBGAME_ACTION", playerId, subGameId: board.id, subAction });
          }
        }
        return actions;
      }
      default:
        return [];
    }
  },
};
