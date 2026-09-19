// apps/backend/gameOptions.test.ts
// 部屋作成時の options 検疫。エンジン予約キー・着席/点数を決めるキーを捨て、
// ゲームごとに公開しているキーだけを型と範囲を確かめて通すことを検証する。
import { describe, it, expect } from "bun:test";
import { sanitizeCreateOptions } from "@engine/backend/gameOptions";
import { UniversalEngine } from "@engine/shared/UniversalEngine";
import { gameRegistry } from "@engine/shared/GameRegistry";

describe("sanitizeCreateOptions", () => {
  it("エンジンのシード・ハッシュ設定はクライアントから受け取らないこと", () => {
    const options = sanitizeCreateOptions("othello", {
      serverSeed: "known-seed",
      clientSeed: "my-client-seed",
      autoHash: false,
      hashInterval: 1000,
      maxHistorySize: 1,
    });
    expect(options).toEqual({ clientSeed: "my-client-seed" });

    // serverSeed を渡しても、エンジンはランダムなシードで動く（serverSeedHash が指定値のハッシュにならない）
    const def = gameRegistry.getDefinition("othello")!;
    const a = new UniversalEngine(def.ruleset, options);
    const b = new UniversalEngine(def.ruleset, options);
    expect(a.getState().prngConfig?.clientSeed).toBe("my-client-seed");
    expect(a.getState().prngConfig?.serverSeedHash).not.toBe(
      b.getState().prngConfig?.serverSeedHash,
    );
  });

  it("着席・点数を決めるキー（playerIds / players / initialScores）を捨てること", () => {
    expect(
      sanitizeCreateOptions("mahjong_match", {
        playerIds: ["me", "me2", "me3", "me4"],
        initialScores: { me: 999999 },
        akaDora: true,
        mode: "TONPU",
      }),
    ).toEqual({ akaDora: true, mode: "TONPU" });
    expect(sanitizeCreateOptions("uno", { players: ["a", "b"] })).toEqual({});
    expect(sanitizeCreateOptions("speed", { playerIds: ["a", "b"] })).toEqual({});
  });

  it("サーバーが解釈する共通キー（playersConfig / addAi）は種別を検査して通すこと", () => {
    expect(
      sanitizeCreateOptions("othello", { playersConfig: ["human", "minimax"], addAi: "random" }),
    ).toEqual({ playersConfig: ["human", "minimax"], addAi: "random" });
    // 未知のボット種別・型違いは捨てる
    expect(sanitizeCreateOptions("othello", { playersConfig: ["human", "llm"] })).toEqual({});
    expect(sanitizeCreateOptions("othello", { addAi: "evil" })).toEqual({});
    expect(sanitizeCreateOptions("othello", { playersConfig: "human" })).toEqual({});
  });

  it("盤サイズなどの数値オプションは範囲外を捨てること（巨大な盤面でメモリを使い潰させない）", () => {
    expect(sanitizeCreateOptions("go", { size: 19, komi: 6.5 })).toEqual({ size: 19, komi: 6.5 });
    expect(sanitizeCreateOptions("go", { size: 100000 })).toEqual({});
    expect(sanitizeCreateOptions("go", { size: 9.5, komi: Infinity })).toEqual({});
    expect(sanitizeCreateOptions("othello", { size: 8 })).toEqual({ size: 8 });
    expect(sanitizeCreateOptions("othello", { size: 1000 })).toEqual({});
    expect(sanitizeCreateOptions("othello_3d", { size: 1000 })).toEqual({});
    expect(sanitizeCreateOptions("tower_of_hanoi", { diskCount: 64 })).toEqual({});
  });

  it("Minesweeper の地雷数は盤面より少ないときだけ通すこと", () => {
    expect(sanitizeCreateOptions("minesweeper", { rows: 5, cols: 5, mineCount: 24 })).toEqual({
      rows: 5,
      cols: 5,
      mineCount: 24,
    });
    expect(sanitizeCreateOptions("minesweeper", { rows: 5, cols: 5, mineCount: 25 })).toEqual({
      rows: 5,
      cols: 5,
    });
    expect(sanitizeCreateOptions("minesweeper", { rows: 1000, cols: 1000 })).toEqual({});
  });

  it("Sudoku の initialBoard は 9×9 の 0〜9 だけ通すこと", () => {
    const board = Array.from({ length: 9 }, () => Array(9).fill(0));
    board[0][0] = 5;
    expect(sanitizeCreateOptions("sudoku", { initialBoard: board })).toEqual({
      initialBoard: board,
    });
    expect(sanitizeCreateOptions("sudoku", { initialBoard: [[1, 2, 3]] })).toEqual({});
    const bad = Array.from({ length: 9 }, () => Array(9).fill(0));
    bad[3][3] = 10;
    expect(sanitizeCreateOptions("sudoku", { initialBoard: bad })).toEqual({});
  });

  it("そのゲームで公開していないキーは、他のゲームの公開キーでも捨てること", () => {
    expect(sanitizeCreateOptions("othello", { initialBoard: [], akaDora: true, size: 8 })).toEqual({
      size: 8,
    });
  });

  it("オブジェクト以外の options は空として扱うこと", () => {
    expect(sanitizeCreateOptions("othello", undefined)).toEqual({});
    expect(sanitizeCreateOptions("othello", null)).toEqual({});
    expect(sanitizeCreateOptions("othello", "serverSeed=x")).toEqual({});
    expect(sanitizeCreateOptions("othello", [1, 2])).toEqual({});
  });
});
