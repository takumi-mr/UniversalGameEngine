import type { BaseGameState, BaseGameAction, GameRuleset } from "../GameRules";
import type { IGameRNG } from "../utils/IGameRNG";

export interface GoState extends BaseGameState {
  board: number[];
  size: number;
  turn: number; // 1: 黒, -1: 白
  passCount: number;
  ko: number | null;
  history: string[]; // For Superko (board states as strings)
  scores?: {
    black: number;
    white: number;
  };
}

export type GoActionType = "PLACE" | "PASS";

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
  const captured: number[] = [];
  const opponent = -color;
  const neighbors = getNeighbors(index, size);

  for (const n of neighbors) {
    if (board[n] === opponent) {
      const group = getGroup(board, n, size);
      const liberties = getLiberties(board, group, size);
      // 置いた場所が最後のダメだった場合、打ち上げ
      if (liberties.size === 0) {
        captured.push(...group);
      }
    }
  }
  return captured;
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
      ko: null,
      history: [
        Array(size * size)
          .fill(0)
          .join(","),
      ],
      players: {
        "1": null,
        "-1": null,
      },
      activePlayers: [],
    };
  },

  isValidAction: (state, action) => {
    if (state.status !== "PLAYING") return false;

    // 手番チェック (エンジンがチェックするはずだが一応)
    if (
      state.players &&
      state.players[state.turn] !== null &&
      action.playerId !== state.players[state.turn]
    ) {
      return false;
    }

    if (action.type === "PASS") return true;

    if (action.type === "PLACE") {
      if (action.index === undefined) return false;
      const idx = action.index;
      if (idx < 0 || idx >= state.board.length) return false;
      if (state.board[idx] !== 0) return false;

      // コのチェック
      if (state.ko === idx) return false;

      // 着手禁止点のチェック (自殺手の禁止)
      // 1. 仮に置いてみる
      const tempBoard = [...state.board];
      tempBoard[idx] = state.turn;

      // 2. 相手を打ち上げられるならOK
      const captures = getCaptures(tempBoard, idx, state.turn, state.size);
      if (captures.length > 0) return true;

      // 3. 自分の呼吸点があるならOK
      const group = getGroup(tempBoard, idx, state.size);
      const liberties = getLiberties(tempBoard, group, state.size);
      if (liberties.size > 0) return true;

      // 相手も取れず、自分も呼吸点がないなら自殺手
      return false;
    }

    return false;
  },

  reduce: (state, action, _rng?: IGameRNG) => {
    const newState = structuredClone(state);
    const board = newState.board;

    if (action.type === "PASS") {
      newState.passCount++;
      newState.turn *= -1;
      newState.ko = null;
      return newState;
    }

    if (action.type === "PLACE") {
      const idx = action.index!;
      board[idx] = state.turn;

      // 打ち上げ
      const captures = getCaptures(board, idx, state.turn, state.size);
      for (const c of captures) {
        board[c] = 0;
      }

      // コの判定 (1個だけ打ち上げ、かつ自分の入れた場所が相手の呼吸点1つの場合)
      // より厳密には Superko で判定するが、1手前の盤面と比較する簡易チェックも入れる
      if (captures.length === 1) {
        const group = getGroup(board, idx, state.size);
        const liberties = getLiberties(board, group, state.size);
        if (group.size === 1 && liberties.size === 1) {
          newState.ko = captures[0];
        } else {
          newState.ko = null;
        }
      } else {
        newState.ko = null;
      }

      newState.passCount = 0;
      newState.turn *= -1;

      // 履歴の更新 (Superko 用)
      newState.history.push(board.join(","));
    }

    newState.activePlayers = newState.players?.[newState.turn]
      ? [newState.players[newState.turn]!]
      : [];
    return newState;
  },

  checkWinCondition: (state) => {
    if (state.passCount >= 2) {
      const blackScore = calculateTrompTaylor(state.board, 1, state.size);
      const whiteScore = calculateTrompTaylor(state.board, -1, state.size) + 6.5; // コミ 6.5
      const winnerKey = blackScore > whiteScore ? 1 : -1;
      const winnerId = state.players?.[winnerKey];

      return {
        isFinished: true,
        winnerIds: winnerId ? [winnerId] : [],
        message: `Both players passed. Black: ${blackScore}, White: ${whiteScore}.`,
      };
    }
    return { isFinished: false };
  },

  applyWinResult: (state, result) => {
    if (!result.isFinished) return state;

    // Tromp-Taylor Scoring
    // 1. 各空き点がどちらの勢力圏か判定する
    // 2. (石の数 + 勢力圏の空き点) で集計
    const blackScore = calculateTrompTaylor(state.board, 1, state.size);
    const whiteScore = calculateTrompTaylor(state.board, -1, state.size) + 6.5; // コミ 6.5

    const winner = blackScore > whiteScore ? "Black" : "White";
    const message = `Game Over. Black: ${blackScore}, White: ${whiteScore}. ${winner} wins!`;

    return {
      ...state,
      status: "FINISHED",
      message,
      scores: {
        black: blackScore,
        white: whiteScore,
      },
    };
  },

  getLegalActions: (state, playerId) => {
    if (state.status !== "PLAYING") return [];

    // 手番チェック
    if (
      state.players &&
      state.players[state.turn] !== null &&
      playerId !== state.players[state.turn]
    ) {
      return [];
    }

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
