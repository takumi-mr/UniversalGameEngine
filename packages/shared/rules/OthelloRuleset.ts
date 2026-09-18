// packages/shared/rules/OthelloRuleset.ts
import type { GameRuleset, BaseGameState, BaseGameAction } from "@engine/shared/GameRules";
import type { IGameRNG } from "@engine/shared/utils/IGameRNG";

export type PlayerColor = 1 | -1; // 1: 黒, -1: 白

export interface OthelloState extends BaseGameState {
  board: number[][];
  currentTurn: PlayerColor;
  scores: Record<number, number>;
  size: number;
  players: Record<PlayerColor, string | null>;
  resignedBy?: PlayerColor; // 投了した側
}

export interface OthelloOptions {
  size?: number; // 偶数、MIN_SIZE〜MAX_SIZE。範囲外や奇数は既定の 8
}

export interface OthelloAction extends BaseGameAction {
  type: "PLACE_PIECE" | "RESIGN";
  x?: number;
  y?: number;
  color?: PlayerColor;
}

export const DEFAULT_SIZE = 8;
export const MIN_SIZE = 4;
export const MAX_SIZE = 16;

/** 盤サイズの正規化（偶数・範囲内でなければ既定値） */
export function normalizeSize(size: unknown): number {
  if (typeof size !== "number" || !Number.isInteger(size)) return DEFAULT_SIZE;
  if (size < MIN_SIZE || size > MAX_SIZE || size % 2 !== 0) return DEFAULT_SIZE;
  return size;
}

// 8方向のベクトル定義
const DIRECTIONS = [
  { dx: -1, dy: -1 },
  { dx: 0, dy: -1 },
  { dx: 1, dy: -1 },
  { dx: -1, dy: 0 },
  { dx: 1, dy: 0 },
  { dx: -1, dy: 1 },
  { dx: 0, dy: 1 },
  { dx: 1, dy: 1 },
];

// 合法手リストを計算するヘルパー関数
function generateLegalMoves(
  board: number[][],
  color: PlayerColor,
  size: number,
): { x: number; y: number }[] {
  const validMoves = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (board[y][x] !== 0) continue;
      const canPlace = DIRECTIONS.some((d) => {
        let count = 0;
        let cx = x + d.dx,
          cy = y + d.dy;
        while (cx >= 0 && cx < size && cy >= 0 && cy < size) {
          const t = board[cy][cx];
          if (t === 0) break;
          if (t === color) return count > 0;
          count++;
          cx += d.dx;
          cy += d.dy;
        }
        return false;
      });
      if (canPlace) validMoves.push({ x, y });
    }
  }
  return validMoves;
}

/** ひっくり返せる石の座標（置けない手なら空） */
function getFlips(
  board: number[][],
  x: number,
  y: number,
  color: PlayerColor,
  size: number,
): { x: number; y: number }[] {
  const flips: { x: number; y: number }[] = [];
  for (const d of DIRECTIONS) {
    const line: { x: number; y: number }[] = [];
    let cx = x + d.dx;
    let cy = y + d.dy;
    while (cx >= 0 && cx < size && cy >= 0 && cy < size) {
      const t = board[cy][cx];
      if (t === 0) break;
      if (t === color) {
        flips.push(...line);
        break;
      }
      line.push({ x: cx, y: cy });
      cx += d.dx;
      cy += d.dy;
    }
  }
  return flips;
}

/** action.playerId がどちらの色か（着席していなければ null。誰も着席していなければ手番側） */
function colorOf(state: OthelloState, playerId?: string): PlayerColor | null {
  if (playerId !== undefined && state.players[1] === playerId) return 1;
  if (playerId !== undefined && state.players[-1] === playerId) return -1;
  if (state.players[1] == null && state.players[-1] == null) return state.currentTurn;
  return null;
}

/** 盤面から石数を数える */
export function countStones(board: number[][]): Record<number, number> {
  const scores: Record<number, number> = { 1: 0, [-1]: 0 };
  for (const row of board) for (const v of row) if (v !== 0) scores[v]++;
  return scores;
}

export const OthelloRuleset: GameRuleset<OthelloState, OthelloAction, OthelloOptions> = {
  getInitialState: (options: OthelloOptions = {}, _rng?: IGameRNG): OthelloState => {
    const size = normalizeSize(options.size);
    const board = Array.from({ length: size }, () => Array(size).fill(0));
    const m = Math.floor(size / 2);

    // 初期配置（標準的な白黒の交差）
    board[m - 1][m - 1] = -1; // 白
    board[m - 1][m] = 1; // 黒
    board[m][m - 1] = 1; // 黒
    board[m][m] = -1; // 白

    const initialState: OthelloState = {
      board,
      currentTurn: 1,
      scores: { 1: 2, [-1]: 2 },
      size,
      players: { 1: null, [-1]: null },
      status: "WAITING",
      message: "",
    };

    return initialState;
  },

  isValidAction: (state, action) => {
    if (state.status !== "PLAYING") return false;
    if (action.type === "RESIGN") return colorOf(state, action.playerId) !== null;
    if (action.type !== "PLACE_PIECE") return false;

    // 手番の色か。着席している側の playerId でなければ不可
    const color = state.currentTurn;
    if (action.color !== color) return false;
    if (colorOf(state, action.playerId) !== color) return false;

    const { x, y } = action;
    if (x === undefined || y === undefined) return false;
    if (!Number.isInteger(x) || !Number.isInteger(y)) return false;
    if (x < 0 || x >= state.size || y < 0 || y >= state.size) return false;
    if (state.board[y][x] !== 0) return false;

    return getFlips(state.board, x, y, color, state.size).length > 0;
  },

  reduce: (state, action, _rng?: IGameRNG) => {
    if (action.type === "RESIGN") {
      const side = colorOf(state, action.playerId) ?? state.currentTurn;
      return {
        ...state,
        resignedBy: side,
        status: "FINISHED",
        activePlayers: [],
        message: `${side === 1 ? "黒" : "白"} が投了しました`,
      };
    }
    if (action.x === undefined || action.y === undefined) return state;

    // 2D配列のディープコピー
    const nextBoard = state.board.map((row) => [...row]);
    const color = state.currentTurn;
    const { x, y } = action;

    nextBoard[y][x] = color;
    for (const f of getFlips(state.board, x, y, color, state.size)) nextBoard[f.y][f.x] = color;
    const nextScores = countStones(nextBoard);

    const nextPlayer = (color * -1) as PlayerColor;
    let nextValidMoves = generateLegalMoves(nextBoard, nextPlayer, state.size);

    let finalTurn = nextPlayer;
    let message = "";

    // パス判定
    if (nextValidMoves.length === 0) {
      nextValidMoves = generateLegalMoves(nextBoard, color, state.size);
      if (nextValidMoves.length === 0) {
        return {
          ...state,
          board: nextBoard,
          scores: nextScores,
          status: "FINISHED",
          activePlayers: [],
          message: "",
        };
      }
      message = `${nextPlayer === 1 ? "黒" : "白"} はパスです！`;
      finalTurn = color;
    }

    return {
      ...state,
      board: nextBoard,
      currentTurn: finalTurn,
      scores: nextScores,
      activePlayers: state.players?.[finalTurn] ? [state.players[finalTurn]!] : [],
      message,
    };
  },

  checkWinCondition: (state) => {
    if (state.resignedBy) {
      const winner = -state.resignedBy as PlayerColor;
      const winnerId = state.players?.[winner];
      return {
        isFinished: true,
        winnerIds: winnerId ? [winnerId] : [],
        message: `${state.resignedBy === 1 ? "黒" : "白"} の投了により ${winner === 1 ? "黒" : "白"} の勝ち！`,
      };
    }
    if (state.status === "FINISHED") {
      const { 1: b, [-1]: w } = state.scores;
      const msg = b > w ? "黒の勝ち！" : w > b ? "白の勝ち！" : "引き分け！";
      const winnerKey = b > w ? 1 : w > b ? -1 : null;
      const winnerIds =
        winnerKey !== null ? (state.players?.[winnerKey] ? [state.players[winnerKey]!] : []) : [];
      return { isFinished: true, winnerIds, message: msg };
    }
    return { isFinished: false, message: state.message };
  },

  getLegalActions: (state, playerId) => {
    if (state.status !== "PLAYING") return [];
    const color = state.currentTurn;
    if (colorOf(state, playerId) !== color) return [];

    const moves = generateLegalMoves(state.board, color, state.size);
    return moves.map((m) => ({
      type: "PLACE_PIECE",
      color,
      x: m.x,
      y: m.y,
      playerId,
    }));
  },
};
