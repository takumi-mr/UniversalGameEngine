/**
 * Sudoku Puzzle Generator
 * バックトラッキング法で完成盤面を生成し、難易度に応じたマスを空白にして問題を作る
 */

type Board = number[][];

/** 0 で埋められた 9x9 盤面を生成 */
function emptyBoard(): Board {
  return Array.from({ length: 9 }, () => Array(9).fill(0));
}

/** その行・列・3x3ブロックに同じ数字がないか確認 */
function isValid(board: Board, row: number, col: number, num: number): boolean {
  for (let i = 0; i < 9; i++) {
    if (board[row][i] === num) return false;
    if (board[i][col] === num) return false;
  }
  const br = Math.floor(row / 3) * 3;
  const bc = Math.floor(col / 3) * 3;
  for (let r = br; r < br + 3; r++) {
    for (let c = bc; c < bc + 3; c++) {
      if (board[r][c] === num) return false;
    }
  }
  return true;
}

/** Fisher–Yates シャッフル */
function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** バックトラッキングで完成盤面を埋める */
function solve(board: Board): boolean {
  for (let row = 0; row < 9; row++) {
    for (let col = 0; col < 9; col++) {
      if (board[row][col] !== 0) continue;
      for (const num of shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9])) {
        if (isValid(board, row, col, num)) {
          board[row][col] = num;
          if (solve(board)) return true;
          board[row][col] = 0;
        }
      }
      return false; // どの数字も置けなかった
    }
  }
  return true; // 全マス埋まった
}

/** 難易度ごとに何マスを空白にするか */
const BLANK_COUNT: Record<string, number> = {
  easy: 30,
  medium: 45,
  hard: 55,
};

/**
 * 数独パズルを生成する
 * @param difficulty - 'easy' | 'medium' | 'hard'
 * @returns 9x9 の数字配列（0 = 空白マス）
 */
export function generatePuzzle(difficulty: "easy" | "medium" | "hard" = "medium"): Board {
  // 完成盤面を生成
  const board = emptyBoard();
  solve(board);

  // ランダムにマスを削除して問題にする
  const blanks = BLANK_COUNT[difficulty] ?? 45;
  const positions = shuffle(Array.from({ length: 81 }, (_, i) => i)).slice(0, blanks);

  for (const pos of positions) {
    board[Math.floor(pos / 9)][pos % 9] = 0;
  }

  return board;
}
