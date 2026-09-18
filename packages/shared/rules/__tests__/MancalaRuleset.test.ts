// packages/shared/rules/__tests__/MancalaRuleset.test.ts
//
// 盤: 0〜5 が P1 のポケット、6 が P1 のストア、7〜12 が P2 のポケット、13 が P2 のストア。
// 種まきは反時計回り（index 増加方向）、相手のストアは飛ばす。
import { expect, test, describe } from "bun:test";
import {
  MancalaRuleset,
  P1_STORE,
  P2_STORE,
  TOTAL_STONES,
  type MancalaState,
  type MancalaAction,
} from "@engine/shared/rules/MancalaRuleset";
import { UniversalEngine } from "@engine/shared/UniversalEngine";
import { ReplayEngine } from "@engine/shared/ReplayEngine";

const P1 = "south";
const P2 = "north";

function position(board: number[], turn: 1 | -1 = 1): MancalaState {
  expect(board.length).toBe(14);
  const state = MancalaRuleset.getInitialState();
  state.board = [...board];
  state.turn = turn;
  state.scores = { 1: board[P1_STORE], "-1": board[P2_STORE] };
  state.status = "PLAYING";
  state.players = { 1: P1, "-1": P2 };
  state.activePlayers = [turn === 1 ? P1 : P2];
  return state;
}

const sow = (pitIndex: number, playerId = P1): MancalaAction => ({
  type: "SOW",
  pitIndex,
  playerId,
});
const total = (board: number[]) => board.reduce((a, b) => a + b, 0);

function startedEngine(seed = "mancala") {
  const engine = new UniversalEngine<MancalaState, MancalaAction>(MancalaRuleset, {
    clientSeed: seed,
    serverSeed: seed,
  });
  engine.dispatch({ type: "JOIN", playerId: P1 } as any);
  engine.dispatch({ type: "JOIN", playerId: P2 } as any);
  engine.dispatch({ type: "START", playerId: P1 } as any);
  return engine;
}

describe("MancalaRuleset: 初期状態と着手の制限", () => {
  test("各ポケット 4 個、ストア 0、P1 の手番で合法手は 6 つ", () => {
    const engine = startedEngine();
    const s = engine.getState();
    expect(s.board).toEqual([4, 4, 4, 4, 4, 4, 0, 4, 4, 4, 4, 4, 4, 0]);
    expect(total(s.board)).toBe(TOTAL_STONES);
    expect(s.turn).toBe(1);
    expect(s.activePlayers).toEqual([P1]);
    expect(engine.getLegalActions(P1).map((a) => a.pitIndex)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(engine.getLegalActions(P2)).toEqual([]);
  });

  test("相手のポケット・ストア・空のポケット・非整数・範囲外・手番外・部外者は不正", () => {
    const state = position([0, 4, 4, 4, 4, 4, 0, 4, 4, 4, 4, 4, 4, 0]);
    expect(MancalaRuleset.isValidAction(state, sow(7))).toBe(false); // 相手のポケット
    expect(MancalaRuleset.isValidAction(state, sow(P1_STORE))).toBe(false);
    expect(MancalaRuleset.isValidAction(state, sow(0))).toBe(false); // 空
    expect(MancalaRuleset.isValidAction(state, sow(1.5))).toBe(false);
    expect(MancalaRuleset.isValidAction(state, sow(-1))).toBe(false);
    expect(MancalaRuleset.isValidAction(state, sow(14))).toBe(false);
    expect(MancalaRuleset.isValidAction(state, { type: "SOW", playerId: P1 })).toBe(false);
    expect(MancalaRuleset.isValidAction(state, sow(1, P2))).toBe(false); // 手番外
    expect(MancalaRuleset.isValidAction(state, sow(1, "someone"))).toBe(false);
    expect(MancalaRuleset.isValidAction(state, sow(1))).toBe(true);
    // P2 の手番なら 7〜12
    const p2 = position([4, 4, 4, 4, 4, 4, 0, 4, 4, 4, 4, 4, 4, 0], -1);
    expect(MancalaRuleset.isValidAction(p2, sow(3, P2))).toBe(false);
    expect(MancalaRuleset.isValidAction(p2, sow(12, P2))).toBe(true);
    expect(MancalaRuleset.getLegalActions(p2, P2).map((a) => a.pitIndex)).toEqual([
      7, 8, 9, 10, 11, 12,
    ]);
  });
});

describe("MancalaRuleset: 種まき", () => {
  test("石を 1 個ずつ次のポケットへ置き、手番が交代する", () => {
    const state = position([4, 4, 4, 4, 4, 4, 0, 4, 4, 4, 4, 4, 4, 0]);
    const next = MancalaRuleset.reduce(state, sow(0));
    expect(next.board).toEqual([0, 5, 5, 5, 5, 4, 0, 4, 4, 4, 4, 4, 4, 0]);
    expect(next.turn).toBe(-1);
    expect(next.activePlayers).toEqual([P2]);
    expect(total(next.board)).toBe(TOTAL_STONES);
  });

  test("最後の石が自分のストアに入ったらもう一度自分の番", () => {
    const state = position([4, 4, 4, 4, 4, 4, 0, 4, 4, 4, 4, 4, 4, 0]);
    const next = MancalaRuleset.reduce(state, sow(2)); // 2 + 4 = 6 = ストア
    expect(next.board[P1_STORE]).toBe(1);
    expect(next.turn).toBe(1);
    expect(next.activePlayers).toEqual([P1]);
    expect(next.message).toContain("Extra Turn");
    expect(next.scores).toEqual({ 1: 1, "-1": 0 });
  });

  test("一周する種まきは相手のストアを飛ばし、自分のポケットにも落ちる", () => {
    const state = position([0, 0, 1, 0, 0, 10, 0, 1, 1, 1, 1, 1, 1, 0]);
    const next = MancalaRuleset.reduce(state, sow(5));
    // 5 → 6(store) 7 8 9 10 11 12 (13 は飛ばす) 0 1 2 → 最後は 2（1 個あったので横取りにはならない）
    expect(next.board).toEqual([1, 1, 2, 0, 0, 0, 1, 2, 2, 2, 2, 2, 2, 0]);
    expect(next.board[P2_STORE]).toBe(0);
    expect(next.turn).toBe(-1);
  });

  test("P2 の種まきは P1 のストアを飛ばす", () => {
    const state = position([1, 1, 1, 1, 1, 1, 0, 1, 1, 0, 0, 0, 8, 0], -1);
    const next = MancalaRuleset.reduce(state, sow(12, P2));
    // 12 → 13(store) 0 1 2 3 4 5 (6 は飛ばす) 7 → 最後は 7（1 個あったので横取りにはならない）
    expect(next.board).toEqual([2, 2, 2, 2, 2, 2, 0, 2, 1, 0, 0, 0, 0, 1]);
    expect(next.board[P1_STORE]).toBe(0);
    expect(next.turn).toBe(1);
  });
});

describe("MancalaRuleset: 横取り", () => {
  test("最後の石が自分の空ポケットに落ち、向かいに石があれば両方をストアへ", () => {
    // 0 番の 1 個を 1 番（空）へ。向かいは 11 番（12 - 1）
    const state = position([1, 0, 4, 4, 4, 4, 0, 4, 4, 4, 4, 5, 4, 0]);
    const next = MancalaRuleset.reduce(state, sow(0));
    expect(next.board[1]).toBe(0);
    expect(next.board[11]).toBe(0);
    expect(next.board[P1_STORE]).toBe(6);
    expect(next.message).toContain("Capture");
    expect(next.turn).toBe(-1);
    expect(total(next.board)).toBe(total(state.board));
  });

  test("向かいが空なら横取りしない。相手側の空ポケットに落ちても横取りしない", () => {
    const empty = position([1, 0, 4, 4, 4, 4, 0, 4, 4, 4, 4, 0, 4, 0]);
    const n1 = MancalaRuleset.reduce(empty, sow(0));
    expect(n1.board[1]).toBe(1);
    expect(n1.board[P1_STORE]).toBe(0);
    expect(n1.message).not.toContain("Capture");

    // 5 番の 2 個 → 6(store), 7(空) に落ちる。7 の向かい 5 は空だが、そもそも相手側なので対象外
    const opp = position([4, 4, 4, 4, 4, 2, 0, 0, 4, 4, 4, 4, 4, 0]);
    const n2 = MancalaRuleset.reduce(opp, sow(5));
    expect(n2.board[7]).toBe(1);
    expect(n2.board[P1_STORE]).toBe(1);
    expect(n2.message).not.toContain("Capture");
  });

  test("P2 側の横取りは向かい（12 - i）の P1 ポケットから", () => {
    const state = position([4, 4, 3, 4, 4, 4, 0, 4, 4, 0, 1, 4, 4, 0], -1);
    const next = MancalaRuleset.reduce(state, sow(10, P2)); // 1 個なので 11 に落ちる。11 には石があるので横取りなし
    expect(next.board[11]).toBe(5);
    expect(next.message).not.toContain("Capture");
    // 9 番（空）に落ちるように 8 番の 1 個を撒く。向かいは 3 番
    const s2 = position([4, 4, 4, 4, 4, 4, 0, 4, 1, 0, 4, 4, 4, 0], -1);
    const n2 = MancalaRuleset.reduce(s2, sow(8, P2));
    expect(n2.board[9]).toBe(0);
    expect(n2.board[3]).toBe(0);
    expect(n2.board[P2_STORE]).toBe(5);
  });
});

describe("MancalaRuleset: 終局", () => {
  test("どちらかの陣地が空になったら、残りは持ち主のストアへ入れて終了", () => {
    const state = position([0, 0, 0, 0, 0, 1, 20, 3, 3, 3, 3, 3, 3, 9]);
    const next = MancalaRuleset.reduce(state, sow(5)); // 5 → ストア（連続ターンだが終局が優先）
    expect(next.status).toBe("FINISHED");
    expect(next.board.slice(0, 6)).toEqual([0, 0, 0, 0, 0, 0]);
    expect(next.board.slice(7, 13)).toEqual([0, 0, 0, 0, 0, 0]);
    expect(next.board[P1_STORE]).toBe(21);
    expect(next.board[P2_STORE]).toBe(9 + 18);
    expect(next.scores).toEqual({ 1: 21, "-1": 27 });
    expect(next.activePlayers).toEqual([]);
    const result = MancalaRuleset.checkWinCondition(next);
    expect(result.isFinished).toBe(true);
    expect(result.winnerIds).toEqual([P2]);
    expect(result.message).toContain("Player 2 Wins");
  });

  test("同点なら引き分け", () => {
    const state = position([0, 0, 0, 0, 0, 1, 23, 0, 0, 0, 0, 0, 0, 24]);
    const next = MancalaRuleset.reduce(state, sow(5));
    expect(next.status).toBe("FINISHED");
    expect(next.scores).toEqual({ 1: 24, "-1": 24 });
    const result = MancalaRuleset.checkWinCondition(next);
    expect(result.winnerIds).toEqual([]);
    expect(result.message).toContain("Draw");
  });

  test("投了は相手の勝ち（手番でなくても可、部外者は不可）", () => {
    const engine = startedEngine();
    expect(engine.dispatch({ type: "RESIGN", playerId: "someone" })).toBe(false);
    expect(engine.dispatch({ type: "RESIGN", playerId: P2 })).toBe(true);
    const s = engine.getState();
    expect(s.status).toBe("FINISHED");
    expect(s.resignedBy).toBe(-1);
    expect(MancalaRuleset.checkWinCondition(s).winnerIds).toEqual([P1]);
    expect(engine.getLegalActions(P1)).toEqual([]);
  });
});

describe("MancalaRuleset: 対局", () => {
  test("合法手だけで終局まで進み、石の総数は常に 48、記録から再現できる", () => {
    const engine = startedEngine("walk");
    let steps = 0;
    while (engine.getState().status === "PLAYING" && steps < 500) {
      const s = engine.getState();
      const pid = s.activePlayers![0];
      const legal = engine.getLegalActions(pid);
      expect(legal.length).toBeGreaterThan(0);
      for (const a of legal) expect(MancalaRuleset.isValidAction(s, a)).toBe(true);
      expect(engine.dispatch(legal[(steps * 3) % legal.length])).toBe(true);
      const after = engine.getState();
      expect(total(after.board)).toBe(TOTAL_STONES);
      expect(after.scores).toEqual({ 1: after.board[P1_STORE], "-1": after.board[P2_STORE] });
      steps++;
    }
    const fin = engine.getState();
    expect(fin.status).toBe("FINISHED");
    expect(fin.board[P1_STORE] + fin.board[P2_STORE]).toBe(TOTAL_STONES);
    expect(MancalaRuleset.checkWinCondition(fin).isFinished).toBe(true);

    const record = engine.getGameRecord("g");
    const replay = new ReplayEngine(MancalaRuleset, {
      ...record,
      finalServerSeed: (fin as any).prngSecret,
    });
    expect(replay.verify(record)).toBe(true);
    expect(replay.getState().board).toEqual(fin.board);
  });
});
