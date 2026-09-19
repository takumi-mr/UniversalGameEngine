// packages/shared/ai/TensorAdapter/GoTensorAdapter.ts
import type { IAITensorAdapter } from "@engine/shared/ai/IAITensorAdapter";
import { GoRuleset } from "@engine/shared/rules/GoRuleset";
import type { GoState, GoAction } from "@engine/shared/rules/GoRuleset";

type Side = 1 | -1;

/**
 * 観測の長さ（N = size × size）: 現在の盤面 N + 直前に石が置かれる前の盤面 N
 * + 連続パス数 1 + 自分視点のコミ 1
 */
export const goObsDim = (size: number) => size * size * 2 + 2;
/** 行動空間の大きさ: 各点に打つ N 通り + パス 1 */
export const goNActions = (size: number) => size * size + 1;
/** パスの actionId（盤上の点の index の次） */
export const goPassAction = (size: number) => size * size;

/**
 * playerId がどちらの側かを返す。
 * 未着席（players が空）の場合は現在の手番の側とみなす（ルールセットの sideOf と同じ扱い）。
 */
function resolveSide(state: GoState, playerId: string): Side {
  if (state.players?.[1] === playerId) return 1;
  if (state.players?.[-1] === playerId) return -1;
  return state.turn === 1 ? 1 : -1;
}

/**
 * 直前に石が置かれる前の盤面を history から復元する（開始直後などで無ければ null）。
 * history は着手（PLACE）のたびに盤面を追記し、パスでは追記しないので、
 * 末尾が現在の盤面、その 1 つ前が「最後の着手の直前の盤面」になる。
 */
function previousBoard(state: GoState): number[] | null {
  const history = state.history ?? [];
  const key = history[history.length - 2];
  if (key === undefined) return null;
  const board = key.split(",").map(Number);
  return board.length === state.board.length ? board : null;
}

/**
 * 囲碁用テンソルアダプタ（盤のサイズ size は局面から取る。既定 9）。
 *
 * - encodeState: 2N + 2 個の数値（N = size × size）。
 *   先頭 N 個は現在の盤面で、自分の石 = +1、相手の石 = -1、空 = 0（白番のプレイヤーから見ると符号反転）。
 *   次の N 個は直前に石が置かれる前の盤面（同じ符号規約。無ければ全 0）。
 *   コウの禁止点（打つと直前の盤面に戻る点）や最後の着手位置をここから読み取れる。
 *   続いて連続パス数（0 か 1。1 なら自分がパスすると終局）、
 *   最後が自分視点のコミ（黒なら -komi、白なら +komi。自分の色も兼ねる）。
 *   盤の幾何は対称なので、視点による回転・反転はしない。
 * - actionId: 打つ点の index（0 〜 N-1）、N がパス。投了は行動空間に含めない。
 */
export const GoTensorAdapter: IAITensorAdapter<GoState, GoAction> = {
  encodeState: (state, playerId) => {
    const me = resolveSide(state, playerId);
    const n = state.board.length;
    const out: number[] = new Array(goObsDim(state.size)).fill(0);
    for (let i = 0; i < n; i++) {
      // 0 * -1 = -0 になるのを避ける（JSON/テスト上のノイズ防止）
      out[i] = (state.board[i] ?? 0) * me || 0;
    }
    const prev = previousBoard(state);
    if (prev) {
      for (let i = 0; i < n; i++) out[n + i] = (prev[i] ?? 0) * me || 0;
    }
    out[2 * n] = state.passCount;
    out[2 * n + 1] = me === 1 ? -state.komi : state.komi;
    return out;
  },

  encodeLegalActions: (state, playerId) => {
    // getLegalActions は PLACE と PASS しか返さない（投了は学習対象外）
    const pass = goPassAction(state.size);
    return GoRuleset.getLegalActions(state, playerId).map((a) =>
      a.type === "PASS" ? pass : a.index!,
    );
  },

  decodeAction: (state, actionId, playerId) => {
    const pass = goPassAction(state.size);
    if (!Number.isInteger(actionId) || actionId < 0 || actionId > pass) {
      throw new Error(`Invalid Go actionId: ${actionId} (expected 0..${pass})`);
    }
    if (actionId === pass) return { type: "PASS", playerId };
    return { type: "PLACE", index: actionId, playerId };
  },
};
