// packages/shared/rules/MahjongRules.ts
import { requireRng } from "../../utils/requireRng";
import { createSecret, type Secret } from "../../GameRules";
import type { BaseGameState, BaseGameAction, GameRuleset } from "../../GameRules";
import type { IGameRNG } from "../../utils/IGameRNG";
import { MahjongHandEvaluator } from "./MahjongHandEvaluator";

// --- Types & Interfaces ---

/** 麻雀の牌表現 (例: 萬子=m, 筒子=p, 索子=s, 字牌=z) */
export type Tile = string;

/** 副露（鳴き）の情報 */
export interface Meld {
  type: "CHI" | "PON" | "KAN";
  tile: Tile;
  consumed: Tile[]; // 鳴きに使用した自分の牌
}

/** 麻雀のゲーム状態 */
export interface MahjongState extends BaseGameState {
  phase: "WAITING" | "PLAYING" | "INTERRUPTING" | "FINISHED";
  playerIds: string[]; // 参加プレイヤー4人のID順序（起家から順）
  wall: Secret<Tile[]>; // 山牌
  deadWall: Secret<Tile[]>; // 王牌
  doraIndicators: Tile[]; // ドラ表示牌
  hands: Record<string, Secret<Tile[]>>; // 各プレイヤーごとの手牌
  discards: Record<string, Tile[]>; // 各プレイヤーの捨て牌（河）
  melds: Record<string, Meld[]>; // 鳴き・副露の情報

  wind: "EAST" | "SOUTH" | "WEST" | "NORTH"; // 場風
  round: number; // 局（1局目=1...）
  turnIndex: number; // 現在のターンプレイヤーのインデックス(0~3)

  scores: Record<string, number>; // 点数
  riichi: Record<string, boolean>;
  riichiSticks: number;
  akaDora: boolean;
  firstDiscardTiles: Record<string, Tile | undefined>;
  firstTurn: boolean;

  /** 割り込みアクション（鳴き、ロン）待ちの状態 */
  pendingDiscard?: {
    playerId: string; // 牌を捨てた人のID
    tile: Tile; // 捨てられた牌
    pendingActions: { playerId: string; action: MahjongAction }[];
  };
}

/** 麻雀のコマンドアクション */
export interface MahjongAction extends BaseGameAction {
  type:
    | "DRAW"
    | "DISCARD"
    | "CALL"
    | "RON"
    | "TSUMO"
    | "PASS"
    | "RIICHI"
    | "KYUUSHU_KYUUHAI"
    | "START";
  tile?: Tile; // 対象の牌
  meldType?: "CHI" | "PON" | "KAN"; // 鳴きの種類
  consumed?: Tile[]; // チー・ポン・カンで手牌から公開する牌
}

// --- Constants & Helpers ---

const INITIAL_SCORE = 25000;
const _WALL_SIZE = 136;
const DEAD_WALL_SIZE = 14;

/** 山牌の生成 */
function createWall(rng?: IGameRNG, akaDora = true): Tile[] {
  const wall: Tile[] = [];
  const suits = ["m", "p", "s"];
  const honors = ["1z", "2z", "3z", "4z", "5z", "6z", "7z"];

  for (let i = 0; i < 4; i++) {
    for (const s of suits) {
      for (let n = 1; n <= 9; n++) wall.push(`${n}${s}`);
    }
    if (akaDora) {
      for (const suit of ["m", "p", "s"]) {
        const index = wall.indexOf(`5${suit}`);
        if (index >= 0) wall[index] = `0${suit}`;
      }
    }
    for (const h of honors) wall.push(h);
  }

  for (let i = wall.length - 1; i > 0; i--) {
    const j = requireRng(rng).nextInt(0, i);
    [wall[i], wall[j]] = [wall[j], wall[i]];
  }
  return wall;
}

/** ターンの更新 */
function advanceTurn(state: MahjongState, nextIndex?: number): Partial<MahjongState> {
  const turnIndex = nextIndex ?? (state.turnIndex + 1) % 4;
  return {
    turnIndex,
    activePlayers: [state.playerIds[turnIndex]],
    phase: "PLAYING",
    pendingDiscard: undefined,
    turnDeadline: undefined,
  };
}

function concealedHandSize(state: MahjongState, playerId: string): number {
  const meldCount = state.melds[playerId]?.length ?? 0;
  return 13 - meldCount * 3;
}

function countTiles(hand: Tile[], tile: Tile): number {
  return hand.filter((candidate) => candidate === tile).length;
}

function sortedTileNumbers(tiles: Tile[]): number[] | undefined {
  if (tiles.length !== 3 || tiles.some((tile) => tile[1] === "z" || tile.length !== 2)) {
    return undefined;
  }
  const suit = tiles[0]?.[1];
  if (!suit || tiles.some((tile) => tile[1] !== suit)) return undefined;
  const numbers = tiles.map((tile) => Number(tile[0])).sort((a, b) => a - b);
  return numbers[0] + 1 === numbers[1] && numbers[1] + 1 === numbers[2] ? numbers : undefined;
}

function callConsumedTiles(state: MahjongState, action: MahjongAction): Tile[] | undefined {
  const discarded = state.pendingDiscard?.tile;
  const hand = state.hands[action.playerId!]?.value ?? [];
  if (!discarded || !action.meldType) return undefined;

  if (action.meldType === "PON") {
    const consumed = action.consumed ?? [discarded, discarded];
    return consumed.length === 2 &&
      consumed.every((tile) => tile === discarded) &&
      countTiles(hand, discarded) >= 2
      ? consumed
      : undefined;
  }

  if (action.meldType === "KAN") {
    const consumed = action.consumed ?? [discarded, discarded, discarded];
    return consumed.length === 3 &&
      consumed.every((tile) => tile === discarded) &&
      countTiles(hand, discarded) >= 3
      ? consumed
      : undefined;
  }

  const discarderIndex = state.playerIds.indexOf(state.pendingDiscard!.playerId);
  if (action.playerId !== state.playerIds[(discarderIndex + 1) % state.playerIds.length]) {
    return undefined;
  }
  const consumed = action.consumed;
  if (!consumed || consumed.length !== 2 || consumed.some((tile) => countTiles(hand, tile) === 0)) {
    return undefined;
  }
  return sortedTileNumbers([...consumed, discarded]) ? consumed : undefined;
}

function isWinningRon(state: MahjongState, playerId: string): boolean {
  const tile = state.pendingDiscard?.tile;
  if (!tile) return false;
  const hand = state.hands[playerId]?.value;
  if (!hand || hand.length !== concealedHandSize(state, playerId)) return false;
  return MahjongHandEvaluator.evaluate(
    [...hand, tile],
    state.melds[playerId] ?? [],
    tile,
    false,
    state,
  ).isAgari;
}

function terminalHonorCount(tiles: Tile[]): number {
  return new Set(
    tiles.filter(
      (tile) => tile[1] === "z" || tile[0] === "1" || tile[0] === "9" || tile[0] === "0",
    ),
  ).size;
}

// --- Action Validators ---

const ACTION_VALIDATORS: Record<
  MahjongAction["type"],
  (state: MahjongState, action: MahjongAction) => boolean
> = {
  START: (state) => {
    const joinedPlayers = Object.values(state.players || {}).filter((p) => p !== null);
    return state.status === "WAITING" && joinedPlayers.length === 4;
  },
  DRAW: (state, action) => {
    if (state.phase !== "PLAYING" || !state.activePlayers?.includes(action.playerId!)) return false;
    const hand = state.hands[action.playerId!]?.value || [];
    return hand.length === concealedHandSize(state, action.playerId!);
  },
  DISCARD: (state, action) => {
    if (state.phase !== "PLAYING" || !state.activePlayers?.includes(action.playerId!)) return false;
    if (!action.tile) return false;
    const hand = state.hands[action.playerId!]?.value || [];
    return (
      hand.includes(action.tile) && hand.length === concealedHandSize(state, action.playerId!) + 1
    );
  },
  TSUMO: (state, action) => {
    if (state.phase !== "PLAYING" || !state.activePlayers?.includes(action.playerId!)) return false;
    const hand = state.hands[action.playerId!]?.value || [];
    return hand.length === concealedHandSize(state, action.playerId!) + 1;
  },
  RIICHI: (state, action) => {
    if (
      state.phase !== "PLAYING" ||
      !state.activePlayers?.includes(action.playerId!) ||
      state.riichi[action.playerId!] ||
      state.scores[action.playerId!] < 1000 ||
      (state.melds[action.playerId!]?.length ?? 0) > 0 ||
      !action.tile
    ) {
      return false;
    }
    const hand = state.hands[action.playerId!]?.value ?? [];
    return hand.length === 14 && hand.includes(action.tile);
  },
  KYUUSHU_KYUUHAI: (state, action) =>
    state.firstTurn &&
    state.phase === "PLAYING" &&
    state.activePlayers?.includes(action.playerId!) === true &&
    terminalHonorCount(state.hands[action.playerId!]?.value ?? []) >= 9,
  CALL: (state, action) => {
    if (state.phase === "INTERRUPTING") {
      if (
        !state.activePlayers?.includes(action.playerId!) ||
        state.pendingDiscard?.pendingActions.some((a) => a.playerId === action.playerId)
      ) {
        return false;
      }
      return callConsumedTiles(state, action) !== undefined;
    }
    return false;
  },
  RON: (state, action) => {
    if (state.phase !== "INTERRUPTING") return false;
    return (
      state.activePlayers?.includes(action.playerId!) === true &&
      !state.pendingDiscard?.pendingActions.some((a) => a.playerId === action.playerId) &&
      isWinningRon(state, action.playerId!)
    );
  },
  PASS: (state, action) => {
    if (state.phase !== "INTERRUPTING") return false;
    return (
      state.activePlayers?.includes(action.playerId!) === true &&
      !state.pendingDiscard?.pendingActions.some((a) => a.playerId === action.playerId)
    );
  },
};

// --- Action Handlers ---

const ACTION_HANDLERS: Record<
  MahjongAction["type"],
  (state: MahjongState, action: MahjongAction, rng?: IGameRNG) => MahjongState
> = {
  START: (state, action, rng) => {
    const playerIds = Object.values(state.players || {}).filter((p) => p !== null) as string[];
    const wallArr = createWall(rng, state.akaDora);
    const deadW: Tile[] = wallArr.splice(-DEAD_WALL_SIZE);
    const doraIndicators = [deadW.pop()!];

    const hands: Record<string, Secret<Tile[]>> = {};
    const discards: Record<string, Tile[]> = {};
    const melds: Record<string, Meld[]> = {};
    const scores: Record<string, number> = {};

    for (const pId of playerIds) {
      scores[pId] = state.scores[pId] ?? INITIAL_SCORE;
      discards[pId] = [];
      melds[pId] = [];
      const handArr = wallArr.splice(0, 13).sort();
      hands[pId] = createSecret(handArr, [pId], Array(handArr.length).fill("?"));
    }

    return {
      ...state,
      status: "PLAYING",
      phase: "PLAYING",
      playerIds,
      wall: createSecret(wallArr, [], Array(wallArr.length).fill("?")),
      deadWall: createSecret(deadW, [], Array(deadW.length).fill("?")),
      doraIndicators,
      hands,
      discards,
      melds,
      scores,
      riichi: Object.fromEntries(playerIds.map((id) => [id, false])),
      riichiSticks: state.riichiSticks,
      firstDiscardTiles: {},
      firstTurn: true,
      turnIndex: 0,
      activePlayers: [playerIds[0]],
    };
  },

  DRAW: (state, action) => {
    const pId = action.playerId!;
    const wallArr = [...state.wall.value];
    const drawTile = wallArr.pop();

    if (!drawTile) {
      return { ...state, status: "FINISHED", phase: "FINISHED", message: "流局 (No tiles left)." };
    }

    const handArr = [...state.hands[pId].value, drawTile];
    return {
      ...state,
      wall: createSecret(wallArr, [], Array(wallArr.length).fill("?")),
      hands: {
        ...state.hands,
        [pId]: createSecret(handArr, [pId], Array(handArr.length).fill("?")),
      },
    };
  },

  DISCARD: (state, action) => {
    const pId = action.playerId!;
    const tile = action.tile!;
    const hand = [...state.hands[pId].value];
    const idx = hand.indexOf(tile);
    hand.splice(idx, 1);

    return {
      ...state,
      phase: "INTERRUPTING",
      hands: {
        ...state.hands,
        [pId]: createSecret(hand, [pId], Array(hand.length).fill("?")),
      },
      discards: {
        ...state.discards,
        [pId]: [...state.discards[pId], tile],
      },
      pendingDiscard: {
        playerId: pId,
        tile,
        pendingActions: [],
      },
      activePlayers: state.playerIds.filter((id) => id !== pId),
      turnDeadline: (action.timestamp || 0) + 10000,
      firstDiscardTiles: state.firstTurn
        ? { ...state.firstDiscardTiles, [pId]: tile }
        : state.firstDiscardTiles,
      firstTurn: false,
    };
  },

  RIICHI: (state, action) => {
    const pId = action.playerId!;
    const nextState = {
      ...state,
      scores: { ...state.scores, [pId]: state.scores[pId] - 1000 },
      riichi: { ...state.riichi, [pId]: true },
      riichiSticks: state.riichiSticks + 1,
    };
    return ACTION_HANDLERS.DISCARD(nextState, action);
  },

  KYUUSHU_KYUUHAI: (state) => ({
    ...state,
    status: "FINISHED",
    phase: "FINISHED",
    activePlayers: [],
    pendingDiscard: undefined,
    message: "九種九牌による途中流局。",
  }),

  TSUMO: (state, action) => {
    const pId = action.playerId!;
    const hand = state.hands[pId].value;
    const result = MahjongHandEvaluator.evaluate(
      hand,
      state.melds[pId],
      hand[hand.length - 1],
      true,
      state,
    );

    if (result.isAgari) {
      const perPlayer = Math.ceil(result.ten / 3);
      const newScores = { ...state.scores };
      for (const id of state.playerIds) {
        if (id === pId) newScores[id] += perPlayer * 3;
        else newScores[id] -= perPlayer;
      }
      return {
        ...state,
        status: "FINISHED",
        phase: "FINISHED",
        scores: newScores,
        message: `Player ${pId} won by TSUMO! [${result.ten}pts]`,
      };
    }
    return { ...state, message: "Invalid TSUMO claim." };
  },

  RON: (state, action) => handleInterruption(state, action),
  CALL: (state, action) => handleInterruption(state, action),
  PASS: (state, action) => handleInterruption(state, action),
};

/** 割り込みアクションの解決 */
function handleInterruption(state: MahjongState, action: MahjongAction): MahjongState {
  if (!state.pendingDiscard) return state;

  const pendingActions = [
    ...state.pendingDiscard.pendingActions,
    { playerId: action.playerId!, action },
  ];
  if (pendingActions.length < (state.activePlayers?.length ?? 0)) {
    return {
      ...state,
      pendingDiscard: { ...state.pendingDiscard, pendingActions },
    };
  }

  // 全員の回答が揃った
  const tile = state.pendingDiscard.tile;
  const discarderId = state.pendingDiscard.playerId;

  // 優先順位: RON > CALL(PON/KAN) > CALL(CHI) > PASS
  const rons = pendingActions.filter((a) => a.action.type === "RON");
  if (rons.length > 0) {
    const newScores = { ...state.scores };
    const messages: string[] = [];
    for (const ron of rons) {
      const winnerId = ron.playerId;
      const hand = [...state.hands[winnerId].value, tile];
      const result = MahjongHandEvaluator.evaluate(hand, state.melds[winnerId], tile, false, state);
      if (result.isAgari) {
        newScores[winnerId] += result.ten;
        newScores[discarderId] -= result.ten;
        messages.push(`Player ${winnerId} won by RON! [${result.ten}pts]`);
      }
    }
    return {
      ...state,
      status: "FINISHED",
      phase: "FINISHED",
      scores: newScores,
      message: messages.join(" | "),
      pendingDiscard: undefined,
    };
  }

  const calls = pendingActions.filter((a) => a.action.type === "CALL");
  const priorityCall = calls.find((a) => a.action.meldType !== "CHI") || calls[0];

  if (priorityCall) {
    const pId = priorityCall.playerId;
    const consumed = callConsumedTiles(state, priorityCall.action);
    if (!consumed) return { ...state, ...advanceTurn(state) };
    const hand = [...state.hands[pId].value];
    for (const tileToRemove of consumed) {
      hand.splice(hand.indexOf(tileToRemove), 1);
    }
    const meld: Meld = {
      type: priorityCall.action.meldType!,
      tile,
      consumed,
    };
    let nextHand = hand;
    let nextWall = state.wall;
    if (meld.type === "KAN") {
      const deadWall = [...state.deadWall.value];
      const replacement = deadWall.pop();
      if (!replacement)
        return {
          ...state,
          status: "FINISHED",
          phase: "FINISHED",
          message: "流局 (No replacement tiles left).",
        };
      nextHand = [...nextHand, replacement];
      nextWall = createSecret(state.wall.value, [], Array(state.wall.value.length).fill("?"));
    }
    return {
      ...state,
      ...advanceTurn(state, state.playerIds.indexOf(pId)),
      wall: nextWall,
      deadWall:
        meld.type === "KAN"
          ? createSecret(
              state.deadWall.value.slice(0, -1),
              [],
              Array(state.deadWall.value.length - 1).fill("?"),
            )
          : state.deadWall,
      hands: {
        ...state.hands,
        [pId]: createSecret(nextHand, [pId], Array(nextHand.length).fill("?")),
      },
      melds: {
        ...state.melds,
        [pId]: [...state.melds[pId], meld],
      },
    };
  }

  // 全員パス
  return {
    ...state,
    ...advanceTurn(state),
  };
}

// --- Ruleset Definition ---

export const MahjongRuleset: GameRuleset<MahjongState, MahjongAction> = {
  getInitialState: (options: any, _rng?: IGameRNG): MahjongState => {
    const playerIds = (options?.playerIds || []).filter((id: any) => !!id);
    return {
      status: "WAITING",
      phase: "WAITING",
      players: { 0: null, 1: null, 2: null, 3: null },
      playerIds,
      activePlayers: [],
      turnIndex: 0,
      wall: createSecret([], [], []),
      deadWall: createSecret([], [], []),
      doraIndicators: [],
      hands: {},
      discards: {},
      melds: {},
      wind: options?.wind ?? "EAST",
      round: options?.round ?? 1,
      scores: options?.initialScores ?? {},
      riichi: {},
      riichiSticks: options?.riichiSticks ?? 0,
      akaDora: options?.akaDora !== false,
      firstDiscardTiles: {},
      firstTurn: true,
    };
  },

  isValidAction: (state, action) => {
    const validator = ACTION_VALIDATORS[action.type];
    return validator ? validator(state, action) : false;
  },

  reduce: (state, action, rng) => {
    const handler = ACTION_HANDLERS[action.type];
    return handler ? handler(state, action, rng) : state;
  },

  getLegalActions: (state, playerId): MahjongAction[] => {
    const actionTypes: MahjongAction["type"][] = [
      "START",
      "DRAW",
      "DISCARD",
      "CALL",
      "RON",
      "TSUMO",
      "PASS",
      "RIICHI",
      "KYUUSHU_KYUUHAI",
    ];
    const actions: MahjongAction[] = [];

    for (const type of actionTypes) {
      if (type === "DISCARD") {
        const hand = state.hands[playerId]?.value || [];
        for (const tile of new Set(hand)) {
          const action = { type, playerId, tile } as MahjongAction;
          if (MahjongRuleset.isValidAction(state, action)) actions.push(action);
        }
      } else {
        const action = { type, playerId } as MahjongAction;
        if (type === "CALL") {
          action.meldType = "PON";
          action.consumed = [state.pendingDiscard?.tile ?? "", state.pendingDiscard?.tile ?? ""];
        }
        if (MahjongRuleset.isValidAction(state, action)) actions.push(action);
      }
    }
    return actions;
  },

  checkWinCondition: (state) => {
    if (state.status === "FINISHED") {
      const match = state.message?.match(/Player (.+?) won/);
      return { isFinished: true, winnerIds: match ? [match[1]] : [], message: state.message };
    }
    return { isFinished: false };
  },

  getTimeoutAction: (state, playerId) => {
    if (state.phase !== "INTERRUPTING" || !state.activePlayers?.includes(playerId)) {
      return null;
    }
    return { type: "PASS", playerId };
  },

  applyWinResult: (state, winResult) => ({
    ...state,
    status: "FINISHED",
    phase: "FINISHED",
    message: winResult.message ?? state.message,
    activePlayers: [],
  }),
};
