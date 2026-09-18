// packages/shared/rules/__tests__/OthelloRuleset.test.ts
//
// 盤は board[y][x]。図は上の行が y=0。X = 黒(1)、O = 白(-1)、. = 空
import { expect, test, describe } from "bun:test";
import {
  OthelloRuleset,
  countStones,
  normalizeSize,
  type OthelloState,
  type OthelloAction,
  type OthelloOptions,
} from "@engine/shared/rules/OthelloRuleset";
import { UniversalEngine, type InternalGameState } from "@engine/shared/UniversalEngine";
import { ReplayEngine } from "@engine/shared/ReplayEngine";

const B = "black";
const W = "white";

function position(rows: string[], turn: 1 | -1 = 1): OthelloState {
  const size = rows.length;
  // 奇数サイズの図も使うので、正規化される getInitialState の size は上書きする
  const state = OthelloRuleset.getInitialState();
  state.size = size;
  state.board = rows.map((row) =>
    [...row.replace(/\s/g, "")].map((c) => (c === "X" ? 1 : c === "O" ? -1 : 0)),
  );
  for (const row of state.board) expect(row.length).toBe(size);
  state.scores = countStones(state.board);
  state.currentTurn = turn;
  state.status = "PLAYING";
  state.players = { 1: B, [-1]: W };
  state.activePlayers = [turn === 1 ? B : W];
  return state;
}

const place = (
  x: number,
  y: number,
  color: 1 | -1 = 1,
  playerId = color === 1 ? B : W,
): OthelloAction => ({
  type: "PLACE_PIECE",
  x,
  y,
  color,
  playerId,
});

function startedEngine(seed = "othello", options: Record<string, unknown> = {}) {
  const engine = new UniversalEngine(OthelloRuleset, {
    clientSeed: seed,
    serverSeed: seed,
    ...options,
  } as OthelloOptions);
  engine.dispatch({ type: "JOIN", playerId: B });
  engine.dispatch({ type: "JOIN", playerId: W });
  engine.dispatch({ type: "START", playerId: B });
  return engine;
}

describe("OthelloRuleset: 初期状態", () => {
  test("8x8 の標準配置で黒番、合法手は 4 つ", () => {
    const engine = startedEngine();
    const s = engine.getState();
    expect(s.size).toBe(8);
    expect(s.board[3][3]).toBe(-1);
    expect(s.board[3][4]).toBe(1);
    expect(s.board[4][3]).toBe(1);
    expect(s.board[4][4]).toBe(-1);
    expect(s.scores).toEqual({ 1: 2, [-1]: 2 });
    expect(s.currentTurn).toBe(1);
    expect(s.activePlayers).toEqual([B]);
    const moves = engine
      .getLegalActions(B)
      .map((a) => `${a.x},${a.y}`)
      .sort();
    expect(moves).toEqual(["2,3", "3,2", "4,5", "5,4"]);
    expect(engine.getLegalActions(W)).toEqual([]);
  });

  test("盤サイズは偶数 4〜16 だけ受け付け、それ以外は 8 になる", () => {
    expect(OthelloRuleset.getInitialState({ size: 6 }).size).toBe(6);
    expect(OthelloRuleset.getInitialState({ size: 6 }).board[2][2]).toBe(-1);
    expect(normalizeSize(7)).toBe(8);
    expect(normalizeSize(2)).toBe(8);
    expect(normalizeSize(100)).toBe(8);
    expect(normalizeSize("8")).toBe(8);
    expect(normalizeSize(undefined)).toBe(8);
  });
});

describe("OthelloRuleset: 着手", () => {
  test("複数方向を同時にひっくり返し、scores は盤面の石数と一致する", () => {
    const state = position([
      ". . . . . .",
      ". O . O . .",
      ". . O O . .",
      ". X O . O X",
      ". . . . . .",
      ". . . . . .",
    ]);
    // (3,3) に黒: 左の O(2,3)、右の O(4,3)、上の O(3,2)(3,1) は上端が空なので返らない、左上斜め (2,2)→(1,1) は端が O で返らない
    // 右斜め上 (4,2) は空。よって左 1 + 右 1
    const next = OthelloRuleset.reduce(state, place(3, 3));
    expect(next.board[3][3]).toBe(1);
    expect(next.board[3][2]).toBe(1);
    expect(next.board[3][4]).toBe(1);
    expect(next.board[2][3]).toBe(-1); // 挟めていない
    expect(next.board[2][2]).toBe(-1);
    expect(next.scores).toEqual(countStones(next.board));
    expect(next.scores[1]).toBe(2 + 3);
    expect(next.currentTurn).toBe(-1);
    expect(next.activePlayers).toEqual([W]);
  });

  test("端まで自分の石が無い方向は返らない。挟めない手は不正", () => {
    const state = position([". . . .", ". O . .", ". . . .", ". . . ."]);
    // 黒は (1,1) の白を挟む石を持たないので、どこにも置けない
    expect(OthelloRuleset.getLegalActions(state, B)).toEqual([]);
    expect(OthelloRuleset.isValidAction(state, place(1, 0))).toBe(false);
  });

  test("盤外・非整数・石のある場所・手番外・相手の色・部外者は不正で、例外も出ない", () => {
    const engine = startedEngine();
    const s = engine.getState();
    expect(OthelloRuleset.isValidAction(s, place(8, 3))).toBe(false);
    expect(OthelloRuleset.isValidAction(s, place(3, -1))).toBe(false);
    expect(OthelloRuleset.isValidAction(s, place(1.5, 3))).toBe(false);
    expect(OthelloRuleset.isValidAction(s, { type: "PLACE_PIECE", color: 1, playerId: B })).toBe(
      false,
    );
    expect(OthelloRuleset.isValidAction(s, place(3, 3))).toBe(false); // 石がある
    expect(OthelloRuleset.isValidAction(s, place(3, 2, -1, W))).toBe(false); // 白は手番外
    expect(OthelloRuleset.isValidAction(s, place(3, 2, -1, B))).toBe(false); // 色が手番と違う
    expect(OthelloRuleset.isValidAction(s, place(3, 2, 1, W))).toBe(false); // 黒の手を白が送る
    expect(OthelloRuleset.isValidAction(s, place(3, 2, 1, "someone"))).toBe(false);
    expect(OthelloRuleset.isValidAction(s, place(3, 2))).toBe(true);
  });
});

describe("OthelloRuleset: パスと終局", () => {
  test("相手に合法手が無ければ自動でパスされ、手番が戻る", () => {
    // 黒が (3,0) で (2,0) を取ると、残る白 (1,2) は端の黒 (0,2) を挟めず白に手が無い。黒は (2,2) で挟める
    const state = position([". X O . .", ". . . . .", "X O . . .", ". . . . .", ". . . . ."]);
    const next = OthelloRuleset.reduce(state, place(3, 0));
    expect(next.board[0]).toEqual([0, 1, 1, 1, 0]);
    expect(OthelloRuleset.getLegalActions(next, W)).toEqual([]);
    expect(OthelloRuleset.getLegalActions(next, B).map((a) => `${a.x},${a.y}`)).toEqual(["2,2"]);
    expect(next.currentTurn).toBe(1); // 白はパス → 黒の手番のまま
    expect(next.message).toContain("パス");
    expect(next.activePlayers).toEqual([B]);
    expect(next.status).toBe("PLAYING");
    expect(OthelloRuleset.checkWinCondition(next).isFinished).toBe(false);
  });

  test("双方に合法手が無ければ終局（全滅・盤が埋まる）", () => {
    // 黒が最後の白を取ると全滅
    const wipe = position(["X O . .", ". . . .", ". . . .", ". . . ."]);
    const done = OthelloRuleset.reduce(wipe, place(2, 0));
    expect(done.status).toBe("FINISHED");
    expect(done.activePlayers).toEqual([]);
    const result = OthelloRuleset.checkWinCondition(done);
    expect(result.isFinished).toBe(true);
    expect(result.winnerIds).toEqual([B]);
    expect(result.message).toContain("黒の勝ち");

    // 盤が埋まる（残り 1 マス）
    const full = position(["X X X X", "O O O O", "X X X X", "O O O ."], -1);
    const filled = OthelloRuleset.reduce(full, place(3, 3, -1));
    expect(filled.status).toBe("FINISHED");
    expect(filled.scores).toEqual({ 1: 8 - 2, [-1]: 7 + 1 + 2 }); // 上 (3,2) と左上斜め (2,2) の X が返る
    expect(OthelloRuleset.checkWinCondition(filled).winnerIds).toEqual([W]);
  });

  test("同数なら引き分け", () => {
    // 黒 6・白 9。黒が (3,3) に置くと左上斜めの O(2,2) だけが返り、8 対 8 で盤が埋まる
    const state = position(["X X O O", "O X O O", "X X O O", "O O X ."]);
    const done = OthelloRuleset.reduce(state, place(3, 3));
    expect(done.status).toBe("FINISHED");
    expect(done.scores).toEqual({ 1: 8, [-1]: 8 });
    const result = OthelloRuleset.checkWinCondition(done);
    expect(result.isFinished).toBe(true);
    expect(result.winnerIds).toEqual([]);
    expect(result.message).toContain("引き分け");
  });

  test("投了は相手の勝ち（手番でなくても可、部外者は不可）", () => {
    const engine = startedEngine();
    expect(engine.dispatch({ type: "RESIGN", playerId: "someone" })).toBe(false);
    expect(engine.dispatch({ type: "RESIGN", playerId: W })).toBe(true);
    const s = engine.getState();
    expect(s.status).toBe("FINISHED");
    expect(s.resignedBy).toBe(-1);
    expect(OthelloRuleset.checkWinCondition(s).winnerIds).toEqual([B]);
    expect(engine.getLegalActions(B)).toEqual([]);
  });
});

describe("OthelloRuleset: 対局", () => {
  test("合法手だけで終局まで進み、scores は常に盤面と一致し、記録から再現できる", () => {
    const engine = startedEngine("walk");
    let steps = 0;
    while (engine.getState().status === "PLAYING" && steps < 200) {
      const s = engine.getState();
      const pid = s.activePlayers![0];
      const legal = engine.getLegalActions(pid);
      expect(legal.length).toBeGreaterThan(0);
      for (const a of legal) expect(OthelloRuleset.isValidAction(s, a)).toBe(true);
      expect(engine.dispatch(legal[(steps * 7) % legal.length])).toBe(true);
      expect(engine.getState().scores).toEqual(countStones(engine.getState().board));
      steps++;
    }
    const fin = engine.getState();
    expect(fin.status).toBe("FINISHED");
    expect(fin.scores[1] + fin.scores[-1]).toBeLessThanOrEqual(64);
    expect(OthelloRuleset.checkWinCondition(fin).isFinished).toBe(true);

    const record = engine.getGameRecord("g");
    const replay = new ReplayEngine(OthelloRuleset, {
      ...record,
      finalServerSeed: (fin as InternalGameState).prngSecret,
    });
    expect(replay.verify(record)).toBe(true);
    expect(replay.getState().board).toEqual(fin.board);
  });
});
