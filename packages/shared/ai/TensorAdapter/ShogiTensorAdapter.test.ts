// packages/shared/ai/TensorAdapter/ShogiTensorAdapter.test.ts
//
// 盤の座標: index = y * 9 + x。y=0 が後手側の最上段。駒の値は ShogiRuleset.test.ts と同じ（正が先手、負が後手）。
import { describe, it, expect } from "bun:test";
import { ShogiRuleset, isInCheck, positionKey } from "@engine/shared/rules/ShogiRuleset";
import type { ShogiState, ShogiAction } from "@engine/shared/rules/ShogiRuleset";
import {
  ShogiTensorAdapter,
  encodeShogiAction,
  SHOGI_OBS_DIM,
  SHOGI_N_ACTIONS,
  SHOGI_ACTION_KINDS,
} from "@engine/shared/ai/TensorAdapter/ShogiTensorAdapter";
import { aiTensorRegistry } from "@engine/shared/ai/AITensorAdapterRegistry";
import "@engine/shared/ai/TensorAdapter/index";

const I = (x: number, y: number) => y * 9 + x;
const P1 = "sente";
const P2 = "gote";

function playingState(): ShogiState {
  const state = ShogiRuleset.getInitialState();
  state.status = "PLAYING";
  state.players = { 1: P1, "-1": P2 };
  state.activePlayers = [P1];
  return state;
}

/** 駒を並べた対局中の局面を作る（未指定のマスは空） */
function position(
  pieces: Record<number, number>,
  opts: { turn?: 1 | -1; hands?: Partial<ShogiState["hands"]> } = {},
): ShogiState {
  const state = playingState();
  state.board = new Array(81).fill(0);
  for (const [i, v] of Object.entries(pieces)) state.board[Number(i)] = v;
  state.turn = opts.turn ?? 1;
  state.hands = { 1: {}, "-1": {}, ...opts.hands };
  state.activePlayers = [state.turn === 1 ? P1 : P2];
  state.positionHistory = [
    { key: positionKey(state), check: isInCheck(state.board, state.turn as 1 | -1) },
  ];
  return state;
}

/** アダプタの符号化が合法手と 1 対 1 に対応し、復号した手が元の手と一致することを確かめる */
function expectRoundTrip(state: ShogiState, playerId: string) {
  const legal = ShogiRuleset.getLegalActions(state, playerId);
  const ids = ShogiTensorAdapter.encodeLegalActions(state, playerId);
  expect(ids.length).toBe(legal.length);
  expect(new Set(ids).size).toBe(ids.length);
  for (let k = 0; k < legal.length; k++) {
    expect(ids[k]).toBeGreaterThanOrEqual(0);
    expect(ids[k]).toBeLessThan(SHOGI_N_ACTIONS);
    const decoded = ShogiTensorAdapter.decodeAction(state, ids[k], playerId);
    expect(decoded).toEqual(legal[k]);
    expect(ShogiRuleset.isValidAction(state, decoded)).toBe(true);
  }
}

describe("ShogiTensorAdapter", () => {
  it("レジストリに 'shogi' と 'shogi_3d' として登録されていること", () => {
    const get = (t: string) => aiTensorRegistry.getAdapter<ShogiState, ShogiAction>(t);
    expect(get("shogi")).toBe(ShogiTensorAdapter);
    expect(get("SHOGI")).toBe(ShogiTensorAdapter);
    expect(get("shogi_3d")).toBe(ShogiTensorAdapter);
  });

  it("定数: 観測 95 要素、行動 81 × 27 = 2187", () => {
    expect(SHOGI_OBS_DIM).toBe(95);
    expect(SHOGI_ACTION_KINDS).toBe(27);
    expect(SHOGI_N_ACTIONS).toBe(2187);
  });

  it("encodeState は先手視点で盤面をそのまま、自分の駒を正・相手の駒を負で返すこと", () => {
    const state = playingState();
    const obs = ShogiTensorAdapter.encodeState(state, P1);
    expect(obs.length).toBe(SHOGI_OBS_DIM);
    // 先手の飛車 (7,7) は +7、後手の飛車 (1,1) は -7、玉はそれぞれ ±8
    expect(obs[I(7, 7)]).toBe(7);
    expect(obs[I(1, 1)]).toBe(-7);
    expect(obs[I(4, 8)]).toBe(8);
    expect(obs[I(4, 0)]).toBe(-8);
    // 空マス
    expect(obs[I(4, 4)]).toBe(0);
    // 持ち駒なし
    expect(obs.slice(81)).toEqual(new Array(14).fill(0));
  });

  it("encodeState は後手視点では盤面を 180 度回転し、符号を反転すること", () => {
    const state = playingState();
    const sente = ShogiTensorAdapter.encodeState(state, P1);
    const gote = ShogiTensorAdapter.encodeState(state, P2);
    for (let i = 0; i < 81; i++) {
      expect(gote[i]).toBe(-sente[80 - i] || 0);
    }
    // 後手から見ると、自分の飛車は自分視点の (7,7) にある
    expect(gote[I(7, 7)]).toBe(7);
    expect(gote[I(4, 8)]).toBe(8);
  });

  it("encodeState は持ち駒を「自分 7 枠 → 相手 7 枠」（歩 香 桂 銀 金 角 飛）の順で返すこと", () => {
    const state = position(
      { [I(4, 8)]: 8, [I(4, 0)]: -8 },
      { hands: { 1: { 1: 3, 7: 1 }, "-1": { 5: 2 } } },
    );
    const sente = ShogiTensorAdapter.encodeState(state, P1);
    expect(sente.slice(81, 88)).toEqual([3, 0, 0, 0, 0, 0, 1]);
    expect(sente.slice(88, 95)).toEqual([0, 0, 0, 0, 2, 0, 0]);
    const gote = ShogiTensorAdapter.encodeState(state, P2);
    expect(gote.slice(81, 88)).toEqual([0, 0, 0, 0, 2, 0, 0]);
    expect(gote.slice(88, 95)).toEqual([3, 0, 0, 0, 0, 0, 1]);
  });

  it("初期局面の先手の合法手 30 手を一意な actionId に符号化し、復号すると元の手に戻ること", () => {
    const state = playingState();
    expect(ShogiRuleset.getLegalActions(state, P1).length).toBe(30);
    expectRoundTrip(state, P1);
    // 手番でないプレイヤーには合法手なし
    expect(ShogiTensorAdapter.encodeLegalActions(state, P2)).toEqual([]);
  });

  it("移動は「移動先 × 27 + 方向」で符号化されること（先手 7六歩 = 上方向）", () => {
    // 先手の歩 (6,6) → (6,5)。移動先 (6,5) = 51、方向 0（上）
    const action: ShogiAction = { type: "MOVE", from: I(6, 6), to: I(6, 5), promote: false };
    expect(encodeShogiAction(action, 1)).toBe(I(6, 5) * 27 + 0);
    // 後手の歩 (2,2) → (2,3) は後手視点では上方向。移動先は回転して 80 - I(2,3)
    const goteAction: ShogiAction = { type: "MOVE", from: I(2, 2), to: I(2, 3), promote: false };
    expect(encodeShogiAction(goteAction, -1)).toBe((80 - I(2, 3)) * 27 + 0);
  });

  it("成りと打つ手は種別が分かれること", () => {
    // 成る: +10
    const promote: ShogiAction = { type: "MOVE", from: I(6, 3), to: I(6, 2), promote: true };
    const noPromote: ShogiAction = { type: "MOVE", from: I(6, 3), to: I(6, 2), promote: false };
    expect(encodeShogiAction(promote, 1) - encodeShogiAction(noPromote, 1)).toBe(10);
    // 打つ: 20 + (歩=0 ... 飛=6)
    expect(encodeShogiAction({ type: "DROP", to: I(4, 4), piece: 1 }, 1)).toBe(I(4, 4) * 27 + 20);
    expect(encodeShogiAction({ type: "DROP", to: I(4, 4), piece: 7 }, 1)).toBe(I(4, 4) * 27 + 26);
    // 桂馬は専用の方向（8 / 9）
    const knight: ShogiAction = { type: "MOVE", from: I(1, 8), to: I(2, 6), promote: false };
    expect(encodeShogiAction(knight, 1) % 27).toBe(9);
  });

  it("飛び駒の移動元は移動先から逆にたどった最初の駒として復元されること", () => {
    // 先手の飛車 (4,7) が (4,2) まで縦に進む。途中は空
    const state = position({ [I(4, 8)]: 8, [I(4, 7)]: 7, [I(4, 0)]: -8 });
    const id = encodeShogiAction({ type: "MOVE", from: I(4, 7), to: I(4, 2), promote: true }, 1);
    expect(ShogiTensorAdapter.decodeAction(state, id, P1)).toEqual({
      type: "MOVE",
      from: I(4, 7),
      to: I(4, 2),
      promote: true,
      playerId: P1,
    });
    expectRoundTrip(state, P1);
  });

  it("持ち駒がある局面でも打つ手を含めて 1 対 1 に符号化できること（後手番）", () => {
    const state = position(
      { [I(4, 8)]: 8, [I(4, 0)]: -8, [I(0, 2)]: -6, [I(8, 7)]: 2 },
      { turn: -1, hands: { "-1": { 1: 2, 3: 1 }, 1: { 5: 1 } } },
    );
    const ids = ShogiTensorAdapter.encodeLegalActions(state, P2);
    // 歩と桂を打つ手が含まれる（種別 20 / 22）
    expect(ids.some((id) => id % 27 === 20)).toBe(true);
    expect(ids.some((id) => id % 27 === 22)).toBe(true);
    expectRoundTrip(state, P2);
  });

  it("両者が決定論的に指し進めた各局面で符号化が 1 対 1 であること", () => {
    let state = playingState();
    for (let ply = 0; ply < 60; ply++) {
      const playerId = state.turn === 1 ? P1 : P2;
      const legal = ShogiRuleset.getLegalActions(state, playerId);
      if (legal.length === 0) break;
      expectRoundTrip(state, playerId);
      // 乱数を使わず、手数に応じて決まる手を選ぶ
      const action = legal[(ply * 7) % legal.length];
      state = ShogiRuleset.reduce(state, action);
      if (ShogiRuleset.checkWinCondition(state).isFinished) break;
    }
  });

  it("範囲外の actionId や駒のない移動は例外を投げること", () => {
    const state = playingState();
    expect(() => ShogiTensorAdapter.decodeAction(state, SHOGI_N_ACTIONS, P1)).toThrow();
    expect(() => ShogiTensorAdapter.decodeAction(state, -1, P1)).toThrow();
    // 空の 5五 (4,4) へ「上」方向: 逆にたどると (4,5) は空、(4,6) に先手の歩がある → 歩の移動として復号される
    const up = ShogiTensorAdapter.decodeAction(state, I(4, 4) * 27 + 0, P1);
    expect(up).toEqual({ type: "MOVE", from: I(4, 6), to: I(4, 4), promote: false, playerId: P1 });
    expect(ShogiRuleset.isValidAction(state, up)).toBe(false);
    // 最下段 (4,8) へ「上」方向: 逆にたどる先が盤外 → 駒が見つからない
    expect(() => ShogiTensorAdapter.decodeAction(state, I(4, 8) * 27 + 0, P1)).toThrow();
  });
});
