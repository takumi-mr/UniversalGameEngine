import { describe, it, expect } from "vitest";
import { generatePuzzle } from "@/utils/sudokuGenerator";

/** 行・列・3x3 ブロックの中で 0 以外の数字が重複していないか */
function hasNoDuplicates(board: number[][]): boolean {
  const groups: number[][] = [];
  for (let i = 0; i < 9; i++) {
    groups.push(board[i]); // 行
    groups.push(board.map((row) => row[i])); // 列
  }
  for (let br = 0; br < 9; br += 3) {
    for (let bc = 0; bc < 9; bc += 3) {
      const block: number[] = [];
      for (let r = br; r < br + 3; r++) {
        for (let c = bc; c < bc + 3; c++) block.push(board[r][c]);
      }
      groups.push(block);
    }
  }
  return groups.every((g) => {
    const filled = g.filter((n) => n !== 0);
    return new Set(filled).size === filled.length;
  });
}

describe("generatePuzzle", () => {
  it("9x9 の盤面を返し、各マスは 0〜9 の整数", () => {
    const board = generatePuzzle();
    expect(board).toHaveLength(9);
    for (const row of board) {
      expect(row).toHaveLength(9);
      for (const n of row) {
        expect(Number.isInteger(n)).toBe(true);
        expect(n).toBeGreaterThanOrEqual(0);
        expect(n).toBeLessThanOrEqual(9);
      }
    }
  });

  it.each([
    ["easy", 30],
    ["medium", 45],
    ["hard", 55],
  ] as const)("難易度 %s は空白マスが %i 個", (difficulty, blanks) => {
    const board = generatePuzzle(difficulty);
    const zeros = board.flat().filter((n) => n === 0).length;
    expect(zeros).toBe(blanks);
  });

  it("既に置かれている数字は数独の制約（行・列・ブロックで重複なし）を満たす", () => {
    // 乱数依存なので複数回生成して確認する
    for (let i = 0; i < 5; i++) {
      expect(hasNoDuplicates(generatePuzzle("hard"))).toBe(true);
    }
  });
});
