import type { BaseGameState, BaseGameAction, GameRuleset } from "../GameRules";
import type { IGameRNG } from "../utils/IGameRNG";

export interface GoState extends BaseGameState {
  board: number[];
  size: number;
  turn: number; // 1: 黒, -1: 白
  passCount: number;
  komi: number; // 白に加算するコミ
  ko: number | null; // 直前の着手で生じた単純コウの禁止点（UI 表示用。判定は history による positional superko）
  history: string[]; // 出現した盤面（positional superko 用）
  captured: { "1": number; "-1": number }; // 打ち上げた石の数（アゲハマ）
  resignedBy?: number; // 投了した側
  scores?: {
    black: number;
    white: number;
  };
}

export type GoActionType = "PLACE" | "PASS" | "RESIGN";
export const DEFAULT_KOMI = 6.5;

export interface GoAction extends BaseGameAction {
  type: GoActionType;
  index?: number;
}

const directions = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/**
 * 隣接する座標のインデックスを取得する
 */
function getNeighbors(index: number, size: number): number[] {
  const x = index % size;
  const y = Math.floor(index / size);
  const result: number[] = [];

  for (const [dX, dY] of directions) {
    const nx = x + dX;
    const ny = y + dY;
    if (nx >= 0 && nx < size && ny >= 0 && ny < size) {
      result.push(ny * size + nx);
    }
  }
  return result;
}

/**
 * 指定した地点の石を含むグループ（連）を取得する
 */
function getGroup(board: number[], start: number, size: number): Set<number> {
  const color = board[start];
  if (color === 0) return new Set();

  const group = new Set<number>();
  const stack = [start];

  while (stack.length) {
    const i = stack.pop()!;
    if (group.has(i)) continue;
    group.add(i);

    for (const n of getNeighbors(i, size)) {
      if (board[n] === color) {
        stack.push(n);
      }
    }
  }
  return group;
}

/**
 * 指定したグループの呼吸点（ダメ）の数を数える
 */
function getLiberties(board: number[], group: Set<number>, size: number): Set<number> {
  const liberties = new Set<number>();
  for (const i of group) {
    for (const n of getNeighbors(i, size)) {
      if (board[n] === 0) {
        liberties.add(n);
      }
    }
  }
  return liberties;
}

/**
 * 石を置いた結果、相手の石を打ち上げられるか判定し、打ち上げられる石を返す
 */
function getCaptures(board: number[], index: number, color: number, size: number): number[] {
  const captured = new Set<number>();
  const opponent = -color;

  for (const n of getNeighbors(index, size)) {
    if (board[n] === opponent && !captured.has(n)) {
      const group = getGroup(board, n, size);
      // 置いた場所が最後のダメだった場合、打ち上げ
      if (getLiberties(board, group, size).size === 0) {
        for (const g of group) captured.add(g);
      }
    }
  }
  return [...captured];
}

/**
 * 着手した結果の盤面（打ち上げ済み）を返す。自殺手なら null。
 * isValidAction と reduce で同じ計算を使う
 */
function resolvePlacement(
  state: GoState,
  idx: number,
): { board: number[]; captures: number[] } | null {
  const board = [...state.board];
  board[idx] = state.turn;
  const captures = getCaptures(board, idx, state.turn, state.size);
  for (const c of captures) board[c] = 0;
  if (captures.length === 0) {
    const group = getGroup(board, idx, state.size);
    if (getLiberties(board, group, state.size).size === 0) return null; // 自殺手
  }
  return { board, captures };
}

/** action.playerId がどちらの側か（着席していなければ null。誰も着席していなければ手番側） */
function sideOf(state: GoState, playerId?: string): number | null {
  const players = state.players ?? {};
  if (playerId !== undefined && players[1] === playerId) return 1;
  if (playerId !== undefined && players[-1] === playerId) return -1;
  if (players[1] == null && players[-1] == null) return state.turn;
  return null;
}

/** 双方の地（Tromp-Taylor）と勝者 */
export function scoreGame(state: GoState): { black: number; white: number; winner: number } {
  const black = calculateTrompTaylor(state.board, 1, state.size);
  const white = calculateTrompTaylor(state.board, -1, state.size) + state.komi;
  return { black, white, winner: black > white ? 1 : -1 };
}

export const GoRuleset: GameRuleset<GoState, GoAction> = {
  getInitialState: (options?: any, _rng?: IGameRNG): GoState => {
    const size = options?.size ?? 9;
    return {
      status: "WAITING",
      size,
      board: Array(size * size).fill(0),
      turn: 1,
      passCount: 0,
      komi: options?.komi ?? DEFAULT_KOMI,
      ko: null,
      history: [
        Array(size * size)
          .fill(0)
          .join(","),
      ],
      captured: { "1": 0, "-1": 0 },
      players: {
        "1": null,
        "-1": null,
      },
      activePlayers: [],
    };
  },

  isValidAction: (state, action) => {
    if (state.status !== "PLAYING") return false;
    if (action.type === "RESIGN") return sideOf(state, action.playerId) !== null;

    // 手番チェック
    if (sideOf(state, action.playerId) !== state.turn) return false;

    if (action.type === "PASS") return true;

    if (action.type === "PLACE") {
      if (action.index === undefined || !Number.isInteger(action.index)) return false;
      const idx = action.index;
      if (idx < 0 || idx >= state.board.length) return false;
      if (state.board[idx] !== 0) return false;

      // 自殺手の禁止
      const resolved = resolvePlacement(state, idx);
      if (!resolved) return false;

      // コウ（positional superko）: 過去に出現した盤面を再現する手は禁止
      return !state.history.includes(resolved.board.join(","));
    }

    return false;
  },

  reduce: (state, action, _rng?: IGameRNG) => {
    const newState = structuredClone(state);

    if (action.type === "RESIGN") {
      const side = sideOf(state, action.playerId) ?? state.turn;
      newState.resignedBy = side;
      newState.status = "FINISHED";
      newState.message = `${side === 1 ? "Black" : "White"} resigned`;
      newState.activePlayers = [];
      return newState;
    }

    if (action.type === "PASS") {
      newState.passCount++;
      newState.turn *= -1;
      newState.ko = null;
    }

    if (action.type === "PLACE") {
      const idx = action.index!;
      const resolved = resolvePlacement(state, idx);
      if (!resolved) return newState;
      const { board, captures } = resolved;
      newState.board = board;
      newState.captured[state.turn === 1 ? "1" : "-1"] += captures.length;

      // 単純コウの禁止点（1 個だけ打ち上げ、置いた石が呼吸点 1 つの単独石）。表示用
      newState.ko = null;
      if (captures.length === 1) {
        const group = getGroup(board, idx, state.size);
        if (group.size === 1 && getLiberties(board, group, state.size).size === 1) {
          newState.ko = captures[0];
        }
      }

      newState.passCount = 0;
      newState.turn *= -1;
      newState.history.push(board.join(","));
    }

    newState.activePlayers = newState.players?.[newState.turn]
      ? [newState.players[newState.turn]!]
      : [];
    return newState;
  },

  checkWinCondition: (state) => {
    if (state.resignedBy) {
      const winner = -state.resignedBy;
      const winnerId = state.players?.[winner];
      return {
        isFinished: true,
        winnerIds: winnerId ? [winnerId] : [],
        message: `${winner === 1 ? "Black" : "White"} wins by resignation.`,
      };
    }
    if (state.passCount >= 2) {
      const { black, white, winner } = scoreGame(state);
      const winnerId = state.players?.[winner];
      return {
        isFinished: true,
        winnerIds: winnerId ? [winnerId] : [],
        message: `Both players passed. Black: ${black}, White: ${white}.`,
      };
    }
    return { isFinished: false };
  },

  applyWinResult: (state, result) => {
    if (!result.isFinished) return state;
    if (state.resignedBy) return { ...state, status: "FINISHED", message: result.message };

    // Tromp-Taylor Scoring: 石の数 + その色だけに到達できる空き点（死に石の合意は無く、打ち切るまで進める前提）
    const { black, white, winner } = scoreGame(state);
    return {
      ...state,
      status: "FINISHED",
      message: `Game Over. Black: ${black}, White: ${white}. ${winner === 1 ? "Black" : "White"} wins!`,
      scores: { black, white },
    };
  },

  getLegalActions: (state, playerId) => {
    if (state.status !== "PLAYING") return [];
    if (sideOf(state, playerId) !== state.turn) return [];

    const actions: GoAction[] = [];
    for (let i = 0; i < state.board.length; i++) {
      const action: GoAction = { type: "PLACE", index: i, playerId };
      if (GoRuleset.isValidAction(state, action)) {
        actions.push(action);
      }
    }

    actions.push({ type: "PASS", playerId });
    return actions;
  },
};

/**
 * Tromp-Taylor ルールによるスコア計算
 * @param board 盤面
 * @param color 対象の色
 * @param size 盤面サイズ
 */
function calculateTrompTaylor(board: number[], color: number, size: number): number {
  let score = 0;
  const _reach = new Set<number>();

  // 指定した色の石の数
  for (let i = 0; i < board.length; i++) {
    if (board[i] === color) {
      score++;
    } else if (board[i] === 0) {
      // 空き点の場合、その点から到達可能な石の色を調べる
      if (canReachOnly(board, i, color, size)) {
        score++;
      }
    }
  }

  return score;
}

/**
 * 指定した空き点から、一色の石のみに到達可能か判定する
 */
function canReachOnly(board: number[], start: number, color: number, size: number): boolean {
  const visited = new Set<number>();
  const stack = [start];
  const opponent = -color;
  let reachedSelf = false;

  while (stack.length) {
    const i = stack.pop()!;
    if (visited.has(i)) continue;
    visited.add(i);

    for (const n of getNeighbors(i, size)) {
      if (board[n] === opponent) return false; // 相手の石に触れたらダメ
      if (board[n] === color) {
        reachedSelf = true;
      } else if (board[n] === 0) {
        stack.push(n);
      }
    }
  }

  return reachedSelf;
}
