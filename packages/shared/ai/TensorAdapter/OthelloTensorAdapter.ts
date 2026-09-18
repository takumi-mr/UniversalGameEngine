// packages/shared/ai/TensorAdapter/OthelloTensorAdapter.ts
import type { IAITensorAdapter } from "@engine/shared/ai/IAITensorAdapter";
import { OthelloRuleset } from "@engine/shared/rules/OthelloRuleset";
import type { OthelloState, OthelloAction, PlayerColor } from "@engine/shared/rules/OthelloRuleset";

/**
 * playerId がどの色を担当しているかを返す。
 * 未着席（players が埋まっていない）場合は現在の手番の色とみなす。
 */
function resolveColor(state: OthelloState, playerId: string): PlayerColor {
  if (state.players?.[1] === playerId) return 1;
  if (state.players?.[-1] === playerId) return -1;
  return state.currentTurn;
}

/**
 * オセロ用テンソルアダプタ。
 *
 * - encodeState: size*size 個の数値（行優先）。自分の石=+1、相手の石=-1、空=0。
 *   視点を固定するため、白番のプレイヤーから見ると盤面は符号反転される。
 * - actionId: y * size + x（0 〜 size*size-1）
 */
export const OthelloTensorAdapter: IAITensorAdapter<OthelloState, OthelloAction> = {
  encodeState: (state, playerId) => {
    const me = resolveColor(state, playerId);
    const out: number[] = new Array(state.size * state.size);
    for (let y = 0; y < state.size; y++) {
      for (let x = 0; x < state.size; x++) {
        // 0 * -1 = -0 になるのを避ける（JSON/テスト上のノイズ防止）
        out[y * state.size + x] = (state.board[y]?.[x] ?? 0) * me || 0;
      }
    }
    return out;
  },

  encodeLegalActions: (state, playerId) => {
    // getLegalActions は PLACE_PIECE しか返さない（投了は学習対象外）
    return OthelloRuleset.getLegalActions(state, playerId).map((a) => a.y! * state.size + a.x!);
  },

  decodeAction: (state, actionId, playerId) => {
    const size = state.size;
    if (!Number.isInteger(actionId) || actionId < 0 || actionId >= size * size) {
      throw new Error(`Invalid Othello actionId: ${actionId} (expected 0..${size * size - 1})`);
    }
    return {
      type: "PLACE_PIECE",
      x: actionId % size,
      y: Math.floor(actionId / size),
      color: resolveColor(state, playerId),
      playerId,
    };
  },
};
