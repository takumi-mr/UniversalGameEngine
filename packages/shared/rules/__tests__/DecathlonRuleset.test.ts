// packages/shared/rules/__tests__/DecathlonRuleset.test.ts
import { describe, it, expect } from "bun:test";
import "../../GameRegistry"; // サブゲームのリゾルバを登録する
import { UniversalEngine } from "../../UniversalEngine";
import { ReplayEngine } from "../../ReplayEngine";
import {
  DecathlonRuleset,
  INTERLUDE_SCENARIO,
  type DecathlonState,
  type DecathlonAction,
} from "../DecathlonRuleset";
import type { TicTacToeAction } from "../TicTacToeRuleset";

type Engine = UniversalEngine<DecathlonState, DecathlonAction>;
const S = (e: Engine) => e.getState();

function started(players: string[], options: Record<string, unknown> = {}, seed = "deca"): Engine {
  const engine = new UniversalEngine<DecathlonState, DecathlonAction>(DecathlonRuleset, {
    clientSeed: seed,
    serverSeed: seed,
    ...options,
  });
  for (const id of players) expect(engine.dispatch({ type: "JOIN", playerId: id })).toBe(true);
  expect(engine.dispatch({ type: "START", playerId: players[0] })).toBe(true);
  return engine;
}

/** 三目並べの盤で first を勝たせる（first が先手のとき） */
function winTicTacToe(engine: Engine, boardId: string, first: string, second: string) {
  const moves: [string, number][] = [
    [first, 0],
    [second, 3],
    [first, 1],
    [second, 4],
    [first, 2],
  ];
  for (const [playerId, index] of moves) {
    const subAction: TicTacToeAction = { type: "PLACE", index };
    expect(
      engine.dispatch({ type: "SUBGAME_ACTION", playerId, subGameId: boardId, subAction }),
      `${playerId} -> ${index}`,
    ).toBe(true);
  }
}

function declareAll(engine: Engine, decl: Record<string, "BOLD" | "SAFE">) {
  for (const [playerId, declaration] of Object.entries(decl)) {
    expect(engine.dispatch({ type: "DECLARE", playerId, declaration })).toBe(true);
  }
}

describe("DecathlonRuleset", () => {
  it("START で開幕し、最初の種目は選択者と 3 候補が提示される", () => {
    const engine = started(["a", "b", "c"], { gamePool: ["tictactoe", "othello", "mancala"] });
    const s = S(engine);
    expect(s.status).toBe("PLAYING");
    expect(s.phase).toBe("PICK");
    expect(s.scores).toEqual({ a: 0, b: 0, c: 0 });
    expect(["a", "b", "c"]).toContain(s.pickerId!);
    expect(s.activePlayers).toEqual([pickerOf(s)]);
    expect([...s.offeredGames].sort()).toEqual(["mancala", "othello", "tictactoe"]);
    expect(s.interludeText).toContain("開幕");
    // 選択者以外は選べない。候補外も選べない
    const other = s.playerIds.find((p) => p !== s.pickerId)!;
    expect(engine.dispatch({ type: "PICK", playerId: other, gameType: "tictactoe" })).toBe(false);
    expect(engine.dispatch({ type: "PICK", playerId: s.pickerId!, gameType: "uno" })).toBe(false);
    expect(engine.getLegalActions(s.pickerId!).length).toBe(3);
  });

  it("2 人用の種目は首位 vs 最下位で組み、3 人なら真ん中が不戦。宣言は秘密で揃ったら盤が開く", () => {
    const engine = started(["a", "b", "c"], { gamePool: ["tictactoe"] });
    let s = S(engine);
    expect(engine.dispatch({ type: "PICK", playerId: s.pickerId!, gameType: "tictactoe" })).toBe(
      true,
    );
    s = S(engine);
    expect(s.phase).toBe("DECLARE");
    expect(s.boards.length).toBe(1);
    expect(s.boards[0].players).toEqual(["a", "c"]); // 同点なので playerIds 順で首位 a、最下位 c
    expect(s.byePlayerId).toBe("b");
    expect([...s.activePlayers!].sort()).toEqual(["a", "c"]);
    expect(engine.dispatch({ type: "DECLARE", playerId: "b", declaration: "SAFE" })).toBe(false);

    engine.dispatch({ type: "DECLARE", playerId: "a", declaration: "BOLD" });
    expect((engine.getMaskedState("c") as any).declarations.a).toBe("?");
    expect((engine.getMaskedState("a") as any).declarations.a).toBe("BOLD");
    expect(S(engine).activePlayers).toEqual(["c"]);

    engine.dispatch({ type: "DECLARE", playerId: "c", declaration: "SAFE" });
    s = S(engine);
    expect(s.phase).toBe("PLAY");
    expect(s.revealedDeclarations).toEqual({ a: "BOLD", c: "SAFE" });
    expect(s.subGames.board1.type).toBe("tictactoe");
    expect(s.subGames.board1.state.status).toBe("PLAYING");
    expect(s.activePlayers).toEqual(["a"]); // 三目並べの先手
    // 不戦の b はサブゲームに手を出せない
    expect(engine.getLegalActions("b")).toEqual([]);
    expect(
      engine.dispatch({
        type: "SUBGAME_ACTION",
        playerId: "b",
        subGameId: "board1",
        subAction: { type: "PLACE", index: 0 } as TicTacToeAction,
      }),
    ).toBe(false);
  });

  it("得点: 勝ち 2、強気で勝てば 2 倍、強気で負ければ 0 で相手に +1、不戦は 1。全種目後に総合優勝", () => {
    const engine = started(["a", "b", "c"], { gamePool: ["tictactoe"], eventCount: 2 });

    // 第 1 種目: a(強気) vs c(堅実)、a が勝つ → a: 4, c: 0, b(不戦): 1
    engine.dispatch({ type: "PICK", playerId: S(engine).pickerId!, gameType: "tictactoe" });
    declareAll(engine, { a: "BOLD", c: "SAFE" });
    winTicTacToe(engine, "board1", "a", "c");
    let s = S(engine);
    expect(s.scores).toEqual({ a: 4, b: 1, c: 0 });
    expect(s.history[0].points).toEqual({ a: 4, b: 1, c: 0 });
    expect(s.eventIndex).toBe(1);
    // 次の種目: 最下位 c が選択者。最終種目なので得点 2 倍
    expect(s.phase).toBe("PICK");
    expect(s.pickerId).toBe("c");
    expect(s.modifier).toBe("DOUBLE");

    // 第 2 種目: 首位 a vs 最下位 c、b は不戦。c(強気) が負ける → a: (2+1)*2=6, c: 0, b: 1*2=2
    engine.dispatch({ type: "PICK", playerId: "c", gameType: "tictactoe" });
    expect(S(engine).boards[0].players).toEqual(["a", "c"]);
    declareAll(engine, { a: "SAFE", c: "BOLD" });
    winTicTacToe(engine, "board1", "a", "c");
    s = S(engine);
    expect(s.history[1].points).toEqual({ a: 6, b: 2, c: 0 });
    expect(s.scores).toEqual({ a: 10, b: 3, c: 0 });
    expect(s.phase).toBe("DONE");
    expect(s.status).toBe("FINISHED");
    expect(s.message).toContain("a の総合優勝");
  });

  it("幕間イベント: 点差 3 以上で最下位ボーナス、最終種目で 2 倍（ScenarioEngine の条件分岐）", () => {
    const engine = started(["a", "b"], { gamePool: ["tictactoe"], eventCount: 3 });
    engine.dispatch({ type: "PICK", playerId: S(engine).pickerId!, gameType: "tictactoe" });
    declareAll(engine, { a: "BOLD", b: "SAFE" });
    winTicTacToe(engine, "board1", "a", "b"); // a: 4, b: 0 → 点差 4
    let s = S(engine);
    expect(s.modifier).toBe("UNDERDOG");
    expect(s.interludeText).toContain("最下位が勝てばボーナス");
    expect(s.pickerId).toBe("b");

    // 最下位 b が堅実で勝つ → 2 + 1（ボーナス）
    engine.dispatch({ type: "PICK", playerId: "b", gameType: "tictactoe" });
    declareAll(engine, { a: "SAFE", b: "SAFE" });
    winTicTacToe(engine, "board1", "a", "b"); // 盤は首位 a が先手 … a が勝つケース
    s = S(engine);
    expect(s.history[1].points).toEqual({ a: 2, b: 0 });
    expect(s.modifier).toBe("DOUBLE"); // 3 種目中の 3 種目目
    expect(Object.keys(INTERLUDE_SCENARIO)).toContain("double");
  });

  it("引き分けは両者 1 点（強気なら 0）", () => {
    const engine = started(["a", "b"], { gamePool: ["tictactoe"], eventCount: 1 });
    engine.dispatch({ type: "PICK", playerId: S(engine).pickerId!, gameType: "tictactoe" });
    declareAll(engine, { a: "SAFE", b: "BOLD" });
    const first = S(engine).activePlayers![0];
    const second = first === "a" ? "b" : "a";
    // 引き分けになる並び: X O X / X O O / O X X
    const seq: [string, number][] = [
      [first, 0],
      [second, 1],
      [first, 2],
      [second, 4],
      [first, 3],
      [second, 5],
      [first, 7],
      [second, 6],
      [first, 8],
    ];
    for (const [playerId, index] of seq) {
      expect(
        engine.dispatch({
          type: "SUBGAME_ACTION",
          playerId,
          subGameId: "board1",
          subAction: { type: "PLACE", index } as TicTacToeAction,
        }),
      ).toBe(true);
    }
    const s = S(engine);
    expect(s.status).toBe("FINISHED");
    expect(s.scores).toEqual({ a: 1, b: 0 }); // 堅実の引き分け 1、強気の引き分け 0（第 1 種目なので修正なし）
    expect(s.message).toContain("a の総合優勝");
  });

  it("4 人・複数種目を合法手だけで完走でき、記録から再現できる（多人数種目 cave_dive を含む）", () => {
    const players = ["p1", "p2", "p3", "p4"];
    const engine = started(
      players,
      { gamePool: ["tictactoe", "cave_dive", "high_low", "mancala"] },
      "walk",
    );
    let steps = 0;
    while (S(engine).status !== "FINISHED" && steps < 20000) {
      const s = S(engine);
      expect(s.activePlayers!.length, `step ${steps} phase ${s.phase}`).toBeGreaterThan(0);
      const pid = s.activePlayers![0];
      const legal = engine.getLegalActions(pid);
      expect(legal.length, `step ${steps}: ${pid} に合法手がない`).toBeGreaterThan(0);
      expect(engine.dispatch(legal[steps % legal.length]), `step ${steps}`).toBe(true);
      steps++;
    }
    const fin = S(engine);
    expect(fin.status).toBe("FINISHED");
    expect(fin.history.length).toBe(5);
    // 4 人の 2 人用種目は 2 盤同時、多人数種目は 1 盤
    for (const rec of fin.history) {
      const seats = rec.game === "cave_dive" ? 4 : 2;
      expect(Object.values(rec.points).length).toBe(4);
      expect(seats).toBeGreaterThan(0);
    }

    const record = engine.getGameRecord("g");
    const replay = new ReplayEngine(DecathlonRuleset, {
      ...record,
      finalServerSeed: (fin as any).prngSecret,
    });
    expect(replay.verify(record)).toBe(true);
    expect(replay.getState().scores).toEqual(fin.scores);
  });
});

function pickerOf(s: DecathlonState) {
  return s.pickerId!;
}
