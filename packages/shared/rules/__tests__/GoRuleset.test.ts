// packages/shared/rules/__tests__/GoRuleset.test.ts
//
// 盤の座標: index = y * size + x。図は上の行が y=0。X = 黒(1)、O = 白(-1)、. = 空点
import { expect, test, describe } from "bun:test";
import {
  GoRuleset,
  scoreGame,
  DEFAULT_KOMI,
  type GoState,
  type GoAction,
} from "@engine/shared/rules/GoRuleset";
import { UniversalEngine } from "@engine/shared/UniversalEngine";

const BLACK = "black";
const WHITE = "white";

/** 図から対局中の局面を作る */
function position(rows: string[], opts: { turn?: 1 | -1; komi?: number } = {}): GoState {
  const size = rows.length;
  const state = GoRuleset.getInitialState({ size, komi: opts.komi });
  state.board = rows.flatMap((row) =>
    [...row.replace(/\s/g, "")].map((c) => (c === "X" ? 1 : c === "O" ? -1 : 0)),
  );
  expect(state.board.length).toBe(size * size);
  state.turn = opts.turn ?? 1;
  state.history = [state.board.join(",")];
  state.status = "PLAYING";
  state.players = { 1: BLACK, "-1": WHITE };
  state.activePlayers = [state.turn === 1 ? BLACK : WHITE];
  return state;
}

const at = (size: number, x: number, y: number) => y * size + x;
const place = (index: number, playerId = BLACK): GoAction => ({ type: "PLACE", index, playerId });
const pass = (playerId = BLACK): GoAction => ({ type: "PASS", playerId });

function startedEngine(seed = "go", options: Record<string, unknown> = {}) {
  const engine = new UniversalEngine<GoState, GoAction>(GoRuleset, {
    clientSeed: seed,
    serverSeed: seed,
    ...options,
  });
  engine.dispatch({ type: "JOIN", playerId: BLACK });
  engine.dispatch({ type: "JOIN", playerId: WHITE });
  engine.dispatch({ type: "START", playerId: BLACK });
  return engine;
}

describe("GoRuleset: 基本", () => {
  test("初期状態は 9x9 の空盤で黒番。全点 + パスが合法手", () => {
    const engine = startedEngine();
    const s = engine.getState();
    expect(s.size).toBe(9);
    expect(s.board.every((v) => v === 0)).toBe(true);
    expect(s.turn).toBe(1);
    expect(s.komi).toBe(DEFAULT_KOMI);
    expect(engine.getLegalActions(BLACK).length).toBe(82);
    expect(engine.getLegalActions(WHITE)).toEqual([]);
    expect(startedEngine("x", { size: 13 }).getState().board.length).toBe(169);
  });

  test("石のある点・盤外・手番外は打てない", () => {
    const engine = startedEngine();
    expect(engine.dispatch(place(40))).toBe(true);
    expect(engine.getState().activePlayers).toEqual([WHITE]);
    expect(engine.dispatch(place(40, WHITE))).toBe(false); // 石がある
    expect(engine.dispatch(place(81, WHITE))).toBe(false); // 盤外
    expect(engine.dispatch(place(41, BLACK))).toBe(false); // 手番外
    expect(engine.dispatch(place(41, WHITE))).toBe(true);
  });
});

describe("GoRuleset: 打ち上げ", () => {
  test("呼吸点がなくなった連は取られ、アゲハマに数える（中央・辺・隅）", () => {
    // 中央の白 1 子: 3 方を黒が囲み、最後の 1 点に打つ
    const center = position([". . . . .", ". . X . .", ". X O . .", ". . X . .", ". . . . ."]);
    const next = GoRuleset.reduce(center, place(at(5, 3, 2)));
    expect(next.board[at(5, 2, 2)]).toBe(0);
    expect(next.captured["1"]).toBe(1);
    expect(next.turn).toBe(-1);

    // 隅の白 2 子: 2 方向の外側を囲めば取れる
    const corner = position(["O O . . .", "X . . . .", ". . . . .", ". . . . .", ". . . . ."]);
    const step1 = GoRuleset.reduce(corner, place(at(5, 2, 0)));
    expect(step1.board[at(5, 0, 0)]).toBe(-1); // まだ 1 呼吸点ある
    const step2 = GoRuleset.reduce({ ...step1, turn: 1 }, place(at(5, 1, 1)));
    expect(step2.board[at(5, 0, 0)]).toBe(0);
    expect(step2.board[at(5, 1, 0)]).toBe(0);
    expect(step2.captured["1"]).toBe(2);
  });

  test("複数の連を同時に取れる", () => {
    // 2,2 に打つと上・左・右の白 1 子がそれぞれ同時に取れる
    const s2 = position([". . X . .", ". X O X .", "X O . O X", ". X . X .", ". . . . ."]);
    const next = GoRuleset.reduce(s2, place(at(5, 2, 2)));
    expect(next.board[at(5, 2, 1)]).toBe(0);
    expect(next.board[at(5, 1, 2)]).toBe(0);
    expect(next.board[at(5, 3, 2)]).toBe(0);
    expect(next.captured["1"]).toBe(3);
  });
});

describe("GoRuleset: 着手禁止点", () => {
  test("自殺手は打てない。ただし相手を取れるなら打てる", () => {
    const suicide = position([". O . . .", "O . O . .", ". O . . .", ". . . . .", ". . . . ."]);
    expect(GoRuleset.isValidAction(suicide, place(at(5, 1, 1)))).toBe(false);
    expect(GoRuleset.getLegalActions(suicide, BLACK).some((a) => a.index === at(5, 1, 1))).toBe(
      false,
    );

    // 同じ形でも、囲んでいる白がさらに黒に囲まれて呼吸点がその 1 点だけなら、打って取れる
    const capture = position(["X O X . .", "O . O X .", "X O X . .", ". X . . .", ". . . . ."]);
    expect(GoRuleset.isValidAction(capture, place(at(5, 1, 1)))).toBe(true);
    const next = GoRuleset.reduce(capture, place(at(5, 1, 1)));
    expect(next.board[at(5, 1, 1)]).toBe(1);
    expect(next.captured["1"]).toBe(4);
  });

  test("コウ: 取り返しは一手置いてから。ko には禁止点が記録される", () => {
    const state = position([". . . . .", ". X O . .", "X . X O .", ". X O . .", ". . . . ."], {
      turn: -1,
    });
    // 白が 1,2 に打って黒 2,2 を取る（コウ取り）
    const taken = GoRuleset.reduce(state, place(at(5, 1, 2), WHITE));
    expect(taken.board[at(5, 2, 2)]).toBe(0);
    expect(taken.ko).toBe(at(5, 2, 2));
    // 黒は即座に取り返せない
    expect(GoRuleset.isValidAction(taken, place(at(5, 2, 2)))).toBe(false);
    // 別の場所に打って白が応じれば、取り返せる
    const tempo = GoRuleset.reduce(taken, place(at(5, 4, 4)));
    const reply = GoRuleset.reduce(tempo, place(at(5, 4, 0), WHITE));
    expect(reply.ko).toBeNull();
    expect(GoRuleset.isValidAction(reply, place(at(5, 2, 2)))).toBe(true);
    const retaken = GoRuleset.reduce(reply, place(at(5, 2, 2)));
    expect(retaken.board[at(5, 1, 2)]).toBe(0);
    expect(retaken.ko).toBe(at(5, 1, 2));
  });

  test("positional superko: 過去に出現した盤面を再現する手は単純コウ以外でも禁止", () => {
    const state = position([". X O . .", "X . X O .", ". X O . .", ". . . . .", ". . . . ."]);
    const idx = at(5, 1, 1);
    expect(GoRuleset.isValidAction(state, place(idx))).toBe(true);
    // 打った後の盤面が過去にあったことにすると禁止になる
    const resulting = [...state.board];
    resulting[idx] = 1;
    const seen = { ...state, history: [...state.history, resulting.join(",")] };
    expect(GoRuleset.isValidAction(seen, place(idx))).toBe(false);
    expect(GoRuleset.getLegalActions(seen, BLACK).some((a) => a.index === idx)).toBe(false);
  });
});

describe("GoRuleset: 終局と計算", () => {
  const territory = [". X . O .", ". X . O .", ". X . O .", ". X . O .", ". X . O ."];

  test("Tromp-Taylor: 石 + その色だけに届く空点。両方に届く空点は数えない", () => {
    const state = position(territory);
    const score = scoreGame(state);
    expect(score.black).toBe(10);
    expect(score.white).toBe(10 + DEFAULT_KOMI);
    expect(score.winner).toBe(-1);
    expect(scoreGame(position(territory, { komi: 0.5 })).white).toBe(10.5);
  });

  test("2 連続パスで終局し、scores とメッセージが入る", () => {
    const engine = startedEngine("score", { size: 5 });
    const s = position(territory, { komi: 0.5 });
    s.prngConfig = engine.getState().prngConfig;
    engine.loadState(s, engine.getReplayData());

    expect(engine.dispatch(pass(BLACK))).toBe(true);
    expect(engine.getState().status).toBe("PLAYING");
    expect(engine.getState().passCount).toBe(1);
    expect(engine.dispatch(place(at(5, 2, 2), WHITE))).toBe(true); // 着手でパス回数はリセット
    expect(engine.getState().passCount).toBe(0);
    expect(engine.dispatch(pass(BLACK))).toBe(true);
    expect(engine.dispatch(pass(WHITE))).toBe(true);
    const fin = engine.getState();
    expect(fin.status).toBe("FINISHED");
    expect(fin.scores).toEqual({ black: 10, white: 11.5 }); // 白は 2,2 の石 + 右の 5 点 + コミ
    expect(fin.message).toContain("White wins");
    expect(GoRuleset.checkWinCondition(fin).winnerIds).toEqual([WHITE]);
  });

  test("投了は相手の勝ち（手番でなくても可、部外者は不可）", () => {
    const engine = startedEngine();
    expect(engine.dispatch({ type: "RESIGN", playerId: "someone" })).toBe(false);
    expect(engine.dispatch({ type: "RESIGN", playerId: WHITE })).toBe(true);
    const s = engine.getState();
    expect(s.status).toBe("FINISHED");
    expect(s.resignedBy).toBe(-1);
    expect(s.scores).toBeUndefined();
    expect(GoRuleset.checkWinCondition(s).winnerIds).toEqual([BLACK]);
  });
});

describe("GoRuleset: 対局", () => {
  test("合法手だけで進めても盤面は矛盾せず、履歴に同じ盤面が 2 度現れない", () => {
    const engine = startedEngine("walk");
    for (let step = 0; step < 80 && engine.getState().status === "PLAYING"; step++) {
      const s = engine.getState();
      const pid = s.activePlayers![0];
      const legal = engine.getLegalActions(pid);
      expect(legal.length).toBeGreaterThan(0);
      const placements = legal.filter((a) => a.type === "PLACE");
      const action = placements.length > 0 ? placements[(step * 13) % placements.length] : legal[0];
      expect(engine.dispatch(action)).toBe(true);
      const after = engine.getState();
      // 呼吸点のない連は残っていない
      for (let i = 0; i < after.board.length; i++) {
        if (after.board[i] === 0) continue;
        const neighbors = [i - 1, i + 1, i - 9, i + 9].filter(
          (n) => n >= 0 && n < 81 && Math.abs((n % 9) - (i % 9)) <= 1,
        );
        const hasLibertyOrFriend = neighbors.some(
          (n) => after.board[n] === 0 || after.board[n] === after.board[i],
        );
        expect(hasLibertyOrFriend).toBe(true);
      }
    }
    const history = engine.getState().history;
    expect(new Set(history).size).toBe(history.length);
  });
});
