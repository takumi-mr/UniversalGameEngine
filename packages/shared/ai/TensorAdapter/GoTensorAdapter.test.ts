// packages/shared/ai/TensorAdapter/GoTensorAdapter.test.ts
//
// 盤の座標: index = y * size + x。図は上の行が y=0。X = 黒(1)、O = 白(-1)、. = 空点
import { describe, it, expect } from "bun:test";
import { GoRuleset } from "@engine/shared/rules/GoRuleset";
import type { GoState, GoAction } from "@engine/shared/rules/GoRuleset";
import {
  GoTensorAdapter,
  goObsDim,
  goNActions,
  goPassAction,
} from "@engine/shared/ai/TensorAdapter/GoTensorAdapter";
import { aiTensorRegistry } from "@engine/shared/ai/AITensorAdapterRegistry";
import "@engine/shared/ai/TensorAdapter/index";

const BLACK = "black";
const WHITE = "white";

function playingState(size = 9): GoState {
  const state = GoRuleset.getInitialState({ size });
  state.status = "PLAYING";
  state.players = { 1: BLACK, "-1": WHITE };
  state.activePlayers = [BLACK];
  return state;
}

/** 図から対局中の局面を作る */
function position(rows: string[], opts: { turn?: 1 | -1; komi?: number } = {}): GoState {
  const state = playingState(rows.length);
  if (opts.komi !== undefined) state.komi = opts.komi;
  state.board = rows.flatMap((row) =>
    [...row.replace(/\s/g, "")].map((c) => (c === "X" ? 1 : c === "O" ? -1 : 0)),
  );
  state.turn = opts.turn ?? 1;
  state.history = [state.board.join(",")];
  state.activePlayers = [state.turn === 1 ? BLACK : WHITE];
  return state;
}

const at = (size: number, x: number, y: number) => y * size + x;

/** アダプタの符号化が合法手と 1 対 1 に対応し、復号した手が元の手と一致することを確かめる */
function expectRoundTrip(state: GoState, playerId: string) {
  const legal = GoRuleset.getLegalActions(state, playerId);
  const ids = GoTensorAdapter.encodeLegalActions(state, playerId);
  expect(ids.length).toBe(legal.length);
  expect(new Set(ids).size).toBe(ids.length);
  for (let k = 0; k < legal.length; k++) {
    expect(ids[k]).toBeGreaterThanOrEqual(0);
    expect(ids[k]).toBeLessThan(goNActions(state.size));
    const decoded = GoTensorAdapter.decodeAction(state, ids[k], playerId);
    expect(decoded).toEqual(legal[k]);
    expect(GoRuleset.isValidAction(state, decoded)).toBe(true);
  }
}

describe("GoTensorAdapter", () => {
  it("レジストリに 'go' として登録されていること", () => {
    const get = (t: string) => aiTensorRegistry.getAdapter<GoState, GoAction>(t);
    expect(get("go")).toBe(GoTensorAdapter);
    expect(get("GO")).toBe(GoTensorAdapter);
  });

  it("定数: 9 路盤は観測 164 要素、行動 82 通り（81 がパス）。13 路盤は 340 / 170", () => {
    expect(goObsDim(9)).toBe(164);
    expect(goNActions(9)).toBe(82);
    expect(goPassAction(9)).toBe(81);
    expect(goObsDim(13)).toBe(340);
    expect(goNActions(13)).toBe(170);
  });

  it("encodeState は黒視点で盤面をそのまま、直前の盤面なし、パス 0、コミ -6.5 を返すこと", () => {
    const state = playingState();
    const obs = GoTensorAdapter.encodeState(state, BLACK);
    expect(obs.length).toBe(goObsDim(9));
    expect(obs.slice(0, 162).every((v) => v === 0)).toBe(true);
    expect(obs[162]).toBe(0);
    expect(obs[163]).toBe(-6.5);
    // 白視点ではコミが +6.5
    expect(GoTensorAdapter.encodeState(state, WHITE)[163]).toBe(6.5);
  });

  it("encodeState は自分の石を +1、相手の石を -1 で返し、白視点では符号反転すること（回転はしない）", () => {
    const state = position(["X . . . .", ". . O . .", ". . . . .", ". . . . .", ". . . . X"]);
    const black = GoTensorAdapter.encodeState(state, BLACK);
    const white = GoTensorAdapter.encodeState(state, WHITE);
    expect(black.length).toBe(goObsDim(5));
    expect(black[at(5, 0, 0)]).toBe(1);
    expect(black[at(5, 2, 1)]).toBe(-1);
    expect(black[at(5, 4, 4)]).toBe(1);
    expect(white[at(5, 0, 0)]).toBe(-1);
    expect(white[at(5, 2, 1)]).toBe(1);
    expect(white[at(5, 4, 4)]).toBe(-1);
    for (let i = 0; i < 25; i++) {
      expect(white[i]).toBe(-black[i] || 0);
      expect(Object.is(white[i], -0)).toBe(false);
    }
    expect(black[50]).toBe(0);
    expect(black[51]).toBe(-6.5);
    expect(white[51]).toBe(6.5);
  });

  it("encodeState は直前に石が置かれる前の盤面と、連続パス数を返すこと", () => {
    let state = playingState(5);
    // 黒が (2,2) に打つ → 白視点: 現在の盤面に相手の石、直前の盤面は空
    state = GoRuleset.reduce(state, { type: "PLACE", index: at(5, 2, 2), playerId: BLACK });
    let obs = GoTensorAdapter.encodeState(state, WHITE);
    expect(obs[at(5, 2, 2)]).toBe(-1);
    expect(obs.slice(25, 50).every((v) => v === 0)).toBe(true);
    expect(obs[50]).toBe(0);

    // 白が (1,1) に打つ → 黒視点: 直前の盤面には自分の石だけがある
    state = GoRuleset.reduce(state, { type: "PLACE", index: at(5, 1, 1), playerId: WHITE });
    obs = GoTensorAdapter.encodeState(state, BLACK);
    expect(obs[at(5, 2, 2)]).toBe(1);
    expect(obs[at(5, 1, 1)]).toBe(-1);
    expect(obs[25 + at(5, 2, 2)]).toBe(1);
    expect(obs[25 + at(5, 1, 1)]).toBe(0);

    // 黒がパス → 白視点: 盤面は変わらず、直前の盤面も同じ（パスは history に積まれない）、パス数 1
    state = GoRuleset.reduce(state, { type: "PASS", playerId: BLACK });
    obs = GoTensorAdapter.encodeState(state, WHITE);
    expect(obs[at(5, 2, 2)]).toBe(-1);
    expect(obs[25 + at(5, 2, 2)]).toBe(-1);
    expect(obs[25 + at(5, 1, 1)]).toBe(0);
    expect(obs[50]).toBe(1);
  });

  it("初期局面の黒の合法手 82 手（全点 + パス）を一意な actionId に符号化し、復号すると元の手に戻ること", () => {
    const state = playingState();
    const ids = GoTensorAdapter.encodeLegalActions(state, BLACK);
    expect(ids.length).toBe(82);
    expect(ids).toContain(goPassAction(9));
    expectRoundTrip(state, BLACK);
    // 手番でないプレイヤーには合法手なし
    expect(GoTensorAdapter.encodeLegalActions(state, WHITE)).toEqual([]);
  });

  it("decodeAction は index を PLACE、N をパスに復元すること", () => {
    const state = playingState();
    expect(GoTensorAdapter.decodeAction(state, 40, BLACK)).toEqual({
      type: "PLACE",
      index: 40,
      playerId: BLACK,
    });
    expect(GoTensorAdapter.decodeAction(state, 81, BLACK)).toEqual({
      type: "PASS",
      playerId: BLACK,
    });
  });

  it("石のある点・自殺手・コウの禁止点は合法手に含まれないこと", () => {
    // コウ形。黒番で (2,1) に打つと白 (1,1) を取り、白は直後に取り返せない
    const ko = position([". X O . .", "X O . O .", ". X O . .", ". . . . .", ". . . . ."], {
      turn: 1,
    });
    // 黒が (2,1) に打つと白 (1,1) を取る（単純コウ）
    const after = GoRuleset.reduce(ko, { type: "PLACE", index: at(5, 2, 1), playerId: BLACK });
    expect(after.board[at(5, 1, 1)]).toBe(0);
    expect(after.ko).toBe(at(5, 1, 1));
    const whiteIds = GoTensorAdapter.encodeLegalActions(after, WHITE);
    expect(whiteIds).not.toContain(at(5, 1, 1)); // コウの取り返し
    expect(whiteIds).not.toContain(at(5, 2, 1)); // 黒石がある
    expect(whiteIds).toContain(goPassAction(5));
    expectRoundTrip(after, WHITE);
    // 白視点の観測: 直前の盤面には (1,1) に自分の石があり、現在は取られて空
    const obs = GoTensorAdapter.encodeState(after, WHITE);
    expect(obs[at(5, 1, 1)]).toBe(0);
    expect(obs[25 + at(5, 1, 1)]).toBe(1);
    expect(obs[at(5, 2, 1)]).toBe(-1);
    expect(obs[25 + at(5, 2, 1)]).toBe(0);

    // 白番。(1,1) と隅の (0,0) は黒に囲まれた自殺手
    const suicide = position([". X . . .", "X . X . .", ". X . . .", ". . . . .", ". . . . ."], {
      turn: -1,
    });
    const ids = GoTensorAdapter.encodeLegalActions(suicide, WHITE);
    expect(ids).not.toContain(at(5, 1, 1));
    expect(ids).not.toContain(at(5, 0, 0));
    expect(ids.length).toBe(25 - 4 - 2 + 1); // 空点 21 - 自殺手 2 + パス
    expectRoundTrip(suicide, WHITE);
  });

  it("両者が決定論的に打ち進めた各局面で符号化が 1 対 1 であること（終局まで）", () => {
    let state = playingState(5);
    let finished = false;
    for (let ply = 0; ply < 200; ply++) {
      const playerId = state.turn === 1 ? BLACK : WHITE;
      const legal = GoRuleset.getLegalActions(state, playerId);
      expect(legal.length).toBeGreaterThan(0);
      expectRoundTrip(state, playerId);
      // 乱数を使わず、手数に応じて決まる手を選ぶ
      const action = legal[(ply * 7) % legal.length];
      state = GoRuleset.reduce(state, action);
      if (GoRuleset.checkWinCondition(state).isFinished) {
        finished = true;
        break;
      }
    }
    expect(finished).toBe(true);
  });

  it("範囲外の actionId は例外を投げること", () => {
    const state = playingState();
    expect(() => GoTensorAdapter.decodeAction(state, goNActions(9), BLACK)).toThrow();
    expect(() => GoTensorAdapter.decodeAction(state, -1, BLACK)).toThrow();
    expect(() => GoTensorAdapter.decodeAction(state, 1.5, BLACK)).toThrow();
    // 石のある点への PLACE は復号はできるが無効な手
    const placed = GoRuleset.reduce(state, { type: "PLACE", index: 40, playerId: BLACK });
    const decoded = GoTensorAdapter.decodeAction(placed, 40, WHITE);
    expect(GoRuleset.isValidAction(placed, decoded)).toBe(false);
  });
});
