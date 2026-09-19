// packages/shared/ai/TensorAdapter/ChessTensorAdapter.test.ts
//
// 盤の座標: index = y * 8 + x。y=0 が黒の最上段（白は y が小さくなる方向へ進む）。駒の値は正が白、負が黒。
import { describe, it, expect } from "bun:test";
import { ChessRuleset, PIECES, positionKey } from "@engine/shared/rules/ChessRuleset";
import type { ChessState, ChessAction } from "@engine/shared/rules/ChessRuleset";
import {
  ChessTensorAdapter,
  encodeChessAction,
  CHESS_OBS_DIM,
  CHESS_N_ACTIONS,
  CHESS_ACTION_KINDS,
} from "@engine/shared/ai/TensorAdapter/ChessTensorAdapter";
import { aiTensorRegistry } from "@engine/shared/ai/AITensorAdapterRegistry";
import "@engine/shared/ai/TensorAdapter/index";

const I = (x: number, y: number) => y * 8 + x;
const P1 = "white";
const P2 = "black";
const KINDS = CHESS_ACTION_KINDS;

function playingState(): ChessState {
  const state = ChessRuleset.getInitialState();
  state.status = "PLAYING";
  state.players = { 1: P1, "-1": P2 };
  state.activePlayers = [P1];
  return state;
}

/** 駒を並べた対局中の局面を作る（未指定のマスは空。キャスリング権は既定でなし） */
function position(
  pieces: Record<number, number>,
  opts: {
    turn?: 1 | -1;
    castling?: Partial<ChessState["castling"]>;
    enPassant?: number | null;
  } = {},
): ChessState {
  const state = playingState();
  state.board = new Array(64).fill(0);
  for (const [i, v] of Object.entries(pieces)) state.board[Number(i)] = v;
  state.turn = opts.turn ?? 1;
  state.castling = { wK: false, wQ: false, bK: false, bQ: false, ...opts.castling };
  state.enPassant = opts.enPassant ?? null;
  state.activePlayers = [state.turn === 1 ? P1 : P2];
  state.positionHistory = [positionKey(state)];
  return state;
}

/** アダプタの符号化が合法手と 1 対 1 に対応し、復号した手が元の手と一致することを確かめる */
function expectRoundTrip(state: ChessState, playerId: string) {
  const legal = ChessRuleset.getLegalActions(state, playerId);
  const ids = ChessTensorAdapter.encodeLegalActions(state, playerId);
  expect(ids.length).toBe(legal.length);
  expect(new Set(ids).size).toBe(ids.length);
  for (let k = 0; k < legal.length; k++) {
    expect(ids[k]).toBeGreaterThanOrEqual(0);
    expect(ids[k]).toBeLessThan(CHESS_N_ACTIONS);
    const decoded = ChessTensorAdapter.decodeAction(state, ids[k], playerId);
    expect(decoded).toEqual(legal[k]);
    expect(ChessRuleset.isValidAction(state, decoded)).toBe(true);
  }
}

describe("ChessTensorAdapter", () => {
  it("レジストリに 'chess' と 'chess_3d' として登録されていること", () => {
    const get = (t: string) => aiTensorRegistry.getAdapter<ChessState, ChessAction>(t);
    expect(get("chess")).toBe(ChessTensorAdapter);
    expect(get("CHESS")).toBe(ChessTensorAdapter);
    expect(get("chess_3d")).toBe(ChessTensorAdapter);
  });

  it("定数: 観測 71 要素、行動 64 × 28 = 1792", () => {
    expect(CHESS_OBS_DIM).toBe(71);
    expect(CHESS_ACTION_KINDS).toBe(28);
    expect(CHESS_N_ACTIONS).toBe(1792);
  });

  it("encodeState は白視点で盤面をそのまま、自分の駒を正・相手の駒を負で返すこと", () => {
    const state = playingState();
    const obs = ChessTensorAdapter.encodeState(state, P1);
    expect(obs.length).toBe(CHESS_OBS_DIM);
    // 白のルーク (0,7) は +4、黒のルーク (0,0) は -4、キングはそれぞれ ±6
    expect(obs[I(0, 7)]).toBe(PIECES.R);
    expect(obs[I(0, 0)]).toBe(-PIECES.R);
    expect(obs[I(4, 7)]).toBe(PIECES.K);
    expect(obs[I(4, 0)]).toBe(-PIECES.K);
    expect(obs[I(3, 7)]).toBe(PIECES.Q);
    expect(obs[I(4, 4)]).toBe(0);
    // キャスリング権 4 つ、アンパッサンなし (-1)、50 手カウンタ 0、同形 1 回目
    expect(obs.slice(64)).toEqual([1, 1, 1, 1, -1, 0, 1]);
  });

  it("encodeState は黒視点では盤面を上下反転し、符号を反転すること（左右は反転しない）", () => {
    const state = playingState();
    const white = ChessTensorAdapter.encodeState(state, P1);
    const black = ChessTensorAdapter.encodeState(state, P2);
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        expect(black[I(x, y)]).toBe(-white[I(x, 7 - y)] || 0);
      }
    }
    // 黒から見ると、自分のキングは自分視点の (4,7)、クイーンは (3,7)（白と同じ位置）
    expect(black[I(4, 7)]).toBe(PIECES.K);
    expect(black[I(3, 7)]).toBe(PIECES.Q);
  });

  it("encodeState はキャスリング権を「自分 K, 自分 Q, 相手 K, 相手 Q」の順で返すこと", () => {
    const state = position(
      { [I(4, 7)]: PIECES.K, [I(7, 7)]: PIECES.R, [I(4, 0)]: -PIECES.K, [I(0, 0)]: -PIECES.R },
      { castling: { wK: true, bQ: true } },
    );
    expect(ChessTensorAdapter.encodeState(state, P1).slice(64, 68)).toEqual([1, 0, 0, 1]);
    expect(ChessTensorAdapter.encodeState(state, P2).slice(64, 68)).toEqual([0, 1, 1, 0]);
  });

  it("encodeState はアンパッサンのマスを自分視点で、50 手カウンタと同形回数をそのまま返すこと", () => {
    // 黒が d7-d5 と 2 歩進めた直後（アンパッサンの対象は d6 = (3,2)）
    const state = position(
      { [I(4, 7)]: PIECES.K, [I(4, 3)]: PIECES.P, [I(4, 0)]: -PIECES.K, [I(3, 3)]: -PIECES.P },
      { enPassant: I(3, 2) },
    );
    state.halfMoves = 7;
    state.positionHistory = ["x", positionKey(state), "y", positionKey(state)];
    const white = ChessTensorAdapter.encodeState(state, P1);
    expect(white[68]).toBe(I(3, 2));
    expect(white[69]).toBe(7);
    expect(white[70]).toBe(2);
    // 黒視点では上下反転した index
    expect(ChessTensorAdapter.encodeState(state, P2)[68]).toBe(I(3, 5));
  });

  it("初期局面の白の合法手 20 手を一意な actionId に符号化し、復号すると元の手に戻ること", () => {
    const state = playingState();
    expect(ChessRuleset.getLegalActions(state, P1).length).toBe(20);
    expectRoundTrip(state, P1);
    // 手番でないプレイヤーには合法手なし
    expect(ChessTensorAdapter.encodeLegalActions(state, P2)).toEqual([]);
  });

  it("移動は「移動先 × 28 + 方向」で符号化されること（e2-e4 = 上方向）", () => {
    // 白の e2 (4,6) → e4 (4,4)。移動先 (4,4) = 36、方向 0（上）
    const e4: ChessAction = { type: "MOVE", from: I(4, 6), to: I(4, 4) };
    expect(encodeChessAction(e4, 1)).toBe(I(4, 4) * KINDS + 0);
    // 黒の e7 (4,1) → e5 (4,3) は黒視点では上方向。移動先は上下反転して (4,4)
    const e5: ChessAction = { type: "MOVE", from: I(4, 1), to: I(4, 3) };
    expect(encodeChessAction(e5, -1)).toBe(I(4, 4) * KINDS + 0);
    // ビショップの斜め移動: c1 (2,7) → h6 (7,2) は右上（方向 2）
    const bishop: ChessAction = { type: "MOVE", from: I(2, 7), to: I(7, 2) };
    expect(encodeChessAction(bishop, 1)).toBe(I(7, 2) * KINDS + 2);
  });

  it("ナイトと昇格は種別が分かれること", () => {
    // ナイト g1 (6,7) → f3 (5,5): オフセット (-1,-2) = 種別 8
    const knight: ChessAction = { type: "MOVE", from: I(6, 7), to: I(5, 5) };
    expect(encodeChessAction(knight, 1)).toBe(I(5, 5) * KINDS + 8);
    // 昇格: 16 + 方向（上 0 / 左上 1 / 右上 2）× 4 + 駒種（Q 0 / R 1 / B 2 / N 3）
    const q: ChessAction = { type: "MOVE", from: I(0, 1), to: I(0, 0), promotion: PIECES.Q };
    expect(encodeChessAction(q, 1)).toBe(I(0, 0) * KINDS + 16);
    const n: ChessAction = { type: "MOVE", from: I(0, 1), to: I(1, 0), promotion: PIECES.N };
    expect(encodeChessAction(n, 1)).toBe(I(1, 0) * KINDS + 16 + 2 * 4 + 3);
    // 昇格しないポーン以外の駒が最終段へ動く手は通常の方向として符号化される
    const rook: ChessAction = { type: "MOVE", from: I(0, 5), to: I(0, 0) };
    expect(encodeChessAction(rook, 1)).toBe(I(0, 0) * KINDS + 0);
  });

  it("スライド駒の移動元は移動先から逆にたどった最初の駒として復元されること", () => {
    // 白のルーク (0,7) が (0,1) まで縦に進む。途中は空
    const state = position({ [I(4, 7)]: PIECES.K, [I(0, 7)]: PIECES.R, [I(4, 0)]: -PIECES.K });
    const id = encodeChessAction({ type: "MOVE", from: I(0, 7), to: I(0, 1) }, 1);
    expect(ChessTensorAdapter.decodeAction(state, id, P1)).toEqual({
      type: "MOVE",
      from: I(0, 7),
      to: I(0, 1),
      playerId: P1,
    });
    expectRoundTrip(state, P1);
  });

  it("キャスリングは「キングが横に 2 マス」として復元できること（白・黒とも同じ種別）", () => {
    const state = position(
      {
        [I(4, 7)]: PIECES.K,
        [I(0, 7)]: PIECES.R,
        [I(7, 7)]: PIECES.R,
        [I(4, 0)]: -PIECES.K,
        [I(0, 0)]: -PIECES.R,
        [I(7, 0)]: -PIECES.R,
      },
      { castling: { wK: true, wQ: true, bK: true, bQ: true } },
    );
    const whiteIds = ChessTensorAdapter.encodeLegalActions(state, P1);
    // キングサイド: 移動先 (6,7) = 62、方向 4（右） / クイーンサイド: 移動先 (2,7) = 58、方向 3（左）
    expect(whiteIds).toContain(I(6, 7) * KINDS + 4);
    expect(whiteIds).toContain(I(2, 7) * KINDS + 3);
    expectRoundTrip(state, P1);

    // 黒番: 上下反転なので黒のキャスリングも同じ actionId になる
    state.turn = -1;
    state.activePlayers = [P2];
    const blackIds = ChessTensorAdapter.encodeLegalActions(state, P2);
    expect(blackIds).toContain(I(6, 7) * KINDS + 4);
    expect(blackIds).toContain(I(2, 7) * KINDS + 3);
    expect(ChessTensorAdapter.decodeAction(state, I(6, 7) * KINDS + 4, P2)).toEqual({
      type: "MOVE",
      from: I(4, 0),
      to: I(6, 0),
      playerId: P2,
    });
    expectRoundTrip(state, P2);
  });

  it("アンパッサンと昇格（黒番）を含めて 1 対 1 に符号化できること", () => {
    // 白: e5 のポーン、黒: d7-d5 の直後 + a2 に昇格直前のポーン。黒番
    const state = position(
      {
        [I(4, 7)]: PIECES.K,
        [I(4, 3)]: PIECES.P,
        [I(4, 0)]: -PIECES.K,
        [I(3, 3)]: -PIECES.P,
        [I(0, 6)]: -PIECES.P,
        [I(1, 7)]: PIECES.N,
      },
      { turn: -1 },
    );
    const ids = ChessTensorAdapter.encodeLegalActions(state, P2);
    // a2-a1 の昇格 4 種（黒視点では (0,1) → (0,0)）と、b1 のナイトを取る昇格 4 種
    for (let slot = 0; slot < 4; slot++) {
      expect(ids).toContain(I(0, 0) * KINDS + 16 + slot);
      expect(ids).toContain(I(1, 0) * KINDS + 16 + 2 * 4 + slot);
    }
    expectRoundTrip(state, P2);

    // 白番に戻してアンパッサン e5xd6（移動先 d6 = (3,2)、方向 1（左上））
    state.turn = 1;
    state.activePlayers = [P1];
    state.enPassant = I(3, 2);
    const whiteIds = ChessTensorAdapter.encodeLegalActions(state, P1);
    expect(whiteIds).toContain(I(3, 2) * KINDS + 1);
    expectRoundTrip(state, P1);
  });

  it("両者が決定論的に指し進めた各局面で符号化が 1 対 1 であること", () => {
    let state = playingState();
    for (let ply = 0; ply < 80; ply++) {
      const playerId = state.turn === 1 ? P1 : P2;
      const legal = ChessRuleset.getLegalActions(state, playerId);
      if (legal.length === 0) break;
      expectRoundTrip(state, playerId);
      // 乱数を使わず、手数に応じて決まる手を選ぶ
      const action = legal[(ply * 7) % legal.length];
      state = ChessRuleset.reduce(state, action);
      if (ChessRuleset.checkWinCondition(state).isFinished) break;
    }
  });

  it("範囲外の actionId や駒のない移動は例外を投げること", () => {
    const state = playingState();
    expect(() => ChessTensorAdapter.decodeAction(state, CHESS_N_ACTIONS, P1)).toThrow();
    expect(() => ChessTensorAdapter.decodeAction(state, -1, P1)).toThrow();
    // 空の e5 (4,3) へ「上」方向: 逆にたどると e4 は空、e2 (4,6) に白のポーンがある → ポーンの移動として復号されるが 3 歩進む手なので無効
    const up = ChessTensorAdapter.decodeAction(state, I(4, 3) * KINDS + 0, P1);
    expect(up).toEqual({ type: "MOVE", from: I(4, 6), to: I(4, 3), playerId: P1 });
    expect(ChessRuleset.isValidAction(state, up)).toBe(false);
    // 最下段 (4,7) へ「上」方向: 逆にたどる先が盤外 → 駒が見つからない
    expect(() => ChessTensorAdapter.decodeAction(state, I(4, 7) * KINDS + 0, P1)).toThrow();
    // ナイト / 昇格の移動元が盤外
    expect(() => ChessTensorAdapter.decodeAction(state, I(0, 0) * KINDS + 8 + 7, P1)).toThrow();
    expect(() =>
      ChessTensorAdapter.decodeAction(state, I(0, 0) * KINDS + 16 + 2 * 4, P1),
    ).toThrow();
    // 投了は符号化できない
    expect(() => encodeChessAction({ type: "RESIGN" }, 1)).toThrow();
  });
});
