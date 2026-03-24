// packages/shared/rules/MahjongRules.ts
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

  /** 割り込みアクション（鳴き、ロン）待ちの状態 */
  pendingDiscard?: {
    playerId: string; // 牌を捨てた人のID
    tile: Tile; // 捨てられた牌
    pendingActions: { playerId: string; action: MahjongAction }[];
  };
}

/** 麻雀のコマンドアクション */
export interface MahjongAction extends BaseGameAction {
  type: "DRAW" | "DISCARD" | "CALL" | "RON" | "TSUMO" | "PASS" | "START";
  tile?: Tile; // 対象の牌
  meldType?: "CHI" | "PON" | "KAN"; // 鳴きの種類
}

// --- Constants & Helpers ---

const INITIAL_SCORE = 25000;
const _WALL_SIZE = 136;
const DEAD_WALL_SIZE = 14;

/** 山牌の生成 */
function createWall(rng?: IGameRNG): Tile[] {
  const wall: Tile[] = [];
  const suits = ["m", "p", "s"];
  const honors = ["1z", "2z", "3z", "4z", "5z", "6z", "7z"];

  for (let i = 0; i < 4; i++) {
    for (const s of suits) {
      for (let n = 1; n <= 9; n++) wall.push(`${n}${s}`);
    }
    for (const h of honors) wall.push(h);
  }

  for (let i = wall.length - 1; i > 0; i--) {
    const j = rng ? rng.nextInt(0, i) : Math.floor(Math.random() * (i + 1));
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
  };
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
    return hand.length === 13;
  },
  DISCARD: (state, action) => {
    if (state.phase !== "PLAYING" || !state.activePlayers?.includes(action.playerId!)) return false;
    if (!action.tile) return false;
    const hand = state.hands[action.playerId!]?.value || [];
    return hand.includes(action.tile) && hand.length === 14;
  },
  TSUMO: (state, action) => {
    if (state.phase !== "PLAYING" || !state.activePlayers?.includes(action.playerId!)) return false;
    const hand = state.hands[action.playerId!]?.value || [];
    return hand.length === 14;
  },
  CALL: (state, action) => {
    if (state.phase === "INTERRUPTING") {
      if (action.playerId === state.pendingDiscard?.playerId) return false;
      return !state.pendingDiscard?.pendingActions.some((a) => a.playerId === action.playerId);
    }
    return false;
  },
  RON: (state, action) => {
    if (state.phase !== "INTERRUPTING") return false;
    if (action.playerId === state.pendingDiscard?.playerId) return false;
    return !state.pendingDiscard?.pendingActions.some((a) => a.playerId === action.playerId);
  },
  PASS: (state, action) => {
    if (state.phase !== "INTERRUPTING") return false;
    return !state.pendingDiscard?.pendingActions.some((a) => a.playerId === action.playerId);
  },
};

// --- Action Handlers ---

const ACTION_HANDLERS: Record<
  MahjongAction["type"],
  (state: MahjongState, action: MahjongAction, rng?: IGameRNG) => MahjongState
> = {
  START: (state, action, rng) => {
    const playerIds = Object.values(state.players || {}).filter((p) => p !== null) as string[];
    const wallArr = createWall(rng);
    const deadW: Tile[] = wallArr.splice(-DEAD_WALL_SIZE);
    const doraIndicators = [deadW.pop()!];

    const hands: Record<string, Secret<Tile[]>> = {};
    const discards: Record<string, Tile[]> = {};
    const melds: Record<string, Meld[]> = {};
    const scores: Record<string, number> = {};

    for (const pId of playerIds) {
      scores[pId] = INITIAL_SCORE;
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
    };
  },

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
  if (pendingActions.length < 3) {
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
    const meld: Meld = {
      type: priorityCall.action.meldType!,
      tile,
      consumed: [], // 本来は手牌から削る処理が必要
    };
    return {
      ...state,
      ...advanceTurn(state, state.playerIds.indexOf(pId)),
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
      players: playerIds.reduce((acc: any, p: string) => ({ ...acc, [p]: p }), {
        0: null,
        1: null,
        2: null,
        3: null,
      }),
      playerIds,
      activePlayers: [],
      turnIndex: 0,
      wall: createSecret([], [], []),
      deadWall: createSecret([], [], []),
      doraIndicators: [],
      hands: {},
      discards: {},
      melds: {},
      wind: "EAST",
      round: 1,
      scores: {},
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
        if (type === "CALL") action.meldType = "PON"; // 簡易化
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

  getTimeoutAction: (_state) => {
    // Note: getTimeoutAction itself might be called with Date.now() by the engine,
    // but the engine is responsible for the timing.
    return null;
  },

  applyWinResult: (state, winResult) => ({
    ...state,
    status: "FINISHED",
    phase: "FINISHED",
    message: winResult.message ?? state.message,
    activePlayers: [],
  }),
};
