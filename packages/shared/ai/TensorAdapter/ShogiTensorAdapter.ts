// packages/shared/ai/TensorAdapter/ShogiTensorAdapter.ts
import type { IAITensorAdapter } from "@engine/shared/ai/IAITensorAdapter";
import { ShogiRuleset } from "@engine/shared/rules/ShogiRuleset";
import type { ShogiState, ShogiAction } from "@engine/shared/rules/ShogiRuleset";

type Side = 1 | -1;

const BOARD_SIZE = 9;
const SQUARES = BOARD_SIZE * BOARD_SIZE;

/** 持ち駒になりうる駒種（歩 香 桂 銀 金 角 飛）。観測の持ち駒スロットと DROP の行動種別はこの順 */
export const SHOGI_HAND_PIECES = [1, 2, 3, 4, 5, 6, 7] as const;

/** 観測の長さ: 盤面 81 + 自分の持ち駒 7 + 相手の持ち駒 7 */
export const SHOGI_OBS_DIM = SQUARES + SHOGI_HAND_PIECES.length * 2;

/**
 * 移動方向（自分視点。自分の駒は y が小さくなる方向へ進む）。
 * 0: 上, 1: 左上, 2: 右上, 3: 左, 4: 右, 5: 下, 6: 左下, 7: 右下, 8: 桂（左）, 9: 桂（右）
 */
const MOVE_DIRECTIONS: readonly (readonly [number, number])[] = [
  [0, -1],
  [-1, -1],
  [1, -1],
  [-1, 0],
  [1, 0],
  [0, 1],
  [-1, 1],
  [1, 1],
  [-1, -2],
  [1, -2],
];
const KNIGHT_DIRECTION_START = 8;
const PROMOTE_OFFSET = 10;
const DROP_OFFSET = 20;

/**
 * 移動先マスごとの行動種別数。
 * 0-9: 移動方向 / 10-19: 移動方向 + 成り / 20-26: 持ち駒を打つ（歩 香 桂 銀 金 角 飛）
 */
export const SHOGI_ACTION_KINDS = DROP_OFFSET + SHOGI_HAND_PIECES.length;

/** 行動空間の大きさ（81 マス × 27 種 = 2187） */
export const SHOGI_N_ACTIONS = SQUARES * SHOGI_ACTION_KINDS;

const toXY = (i: number): [number, number] => [i % BOARD_SIZE, Math.floor(i / BOARD_SIZE)];
const toI = (x: number, y: number) => y * BOARD_SIZE + x;
const inBounds = (x: number, y: number) => x >= 0 && x < BOARD_SIZE && y >= 0 && y < BOARD_SIZE;

/**
 * 盤面のマス index を「自分視点」の index に変換する（逆変換も同じ関数）。
 * 後手は盤を 180 度回転して、常に自分の駒が上（y=0 方向）へ進む座標系にする。
 */
const toPerspective = (index: number, side: Side) => (side === 1 ? index : SQUARES - 1 - index);

/**
 * playerId がどちらの側かを返す。
 * 未着席（players が空）の場合は現在の手番の側とみなす（ルールセットの sideOf と同じ扱い）。
 */
function resolveSide(state: ShogiState, playerId: string): Side {
  if (state.players?.[1] === playerId) return 1;
  if (state.players?.[-1] === playerId) return -1;
  return state.turn as Side;
}

/**
 * MOVE / DROP を actionId に変換する（自分視点の座標で符号化する）。
 *
 * 移動は「移動先 + 方向」で表す。移動元は、移動先から方向を逆にたどって最初にぶつかる駒なので一意に復元できる
 * （飛び駒は途中に駒があれば越えられないため、同じ移動先・同じ方向に来られる自分の駒は 1 つしかない）。
 */
export function encodeShogiAction(action: ShogiAction, side: Side): number {
  if (action.to === undefined) throw new Error("Shogi action has no destination");
  const toP = toPerspective(action.to, side);

  if (action.type === "DROP") {
    const slot = SHOGI_HAND_PIECES.indexOf(action.piece as (typeof SHOGI_HAND_PIECES)[number]);
    if (slot < 0) throw new Error(`Cannot drop piece type ${action.piece}`);
    return toP * SHOGI_ACTION_KINDS + DROP_OFFSET + slot;
  }

  if (action.type !== "MOVE" || action.from === undefined) {
    throw new Error(`Cannot encode Shogi action of type ${action.type}`);
  }
  const [fx, fy] = toXY(toPerspective(action.from, side));
  const [tx, ty] = toXY(toP);
  const dx = tx - fx;
  const dy = ty - fy;
  let direction: number;
  if (Math.abs(dx) === 1 && dy === -2) {
    direction = KNIGHT_DIRECTION_START + (dx < 0 ? 0 : 1);
  } else {
    const sx = Math.sign(dx);
    const sy = Math.sign(dy);
    direction = MOVE_DIRECTIONS.slice(0, KNIGHT_DIRECTION_START).findIndex(
      ([ddx, ddy]) => ddx === sx && ddy === sy,
    );
    if (direction < 0) throw new Error(`Not a straight Shogi move: ${action.from} -> ${action.to}`);
  }
  return toP * SHOGI_ACTION_KINDS + direction + (action.promote ? PROMOTE_OFFSET : 0);
}

/**
 * 将棋用テンソルアダプタ。
 *
 * - encodeState: 95 個の数値。先頭 81 個は自分視点（後手は 180 度回転）の盤面で、
 *   自分の駒 = +駒種（1〜14）、相手の駒 = -駒種、空 = 0。続く 7 個が自分の持ち駒の枚数（歩 香 桂 銀 金 角 飛）、
 *   最後の 7 個が相手の持ち駒の枚数。
 * - actionId: 移動先マス（自分視点）× 27 + 種別。種別は 0-9 が移動方向、10-19 が移動方向 + 成り、
 *   20-26 が持ち駒を打つ（0 〜 2186）。
 */
export const ShogiTensorAdapter: IAITensorAdapter<ShogiState, ShogiAction> = {
  encodeState: (state, playerId) => {
    const me = resolveSide(state, playerId);
    const out: number[] = new Array(SHOGI_OBS_DIM).fill(0);
    for (let i = 0; i < SQUARES; i++) {
      const v = state.board[i] ?? 0;
      if (v === 0) continue;
      out[toPerspective(i, me)] = Math.sign(v) === me ? Math.abs(v) : -Math.abs(v);
    }
    const myHand = state.hands[me] ?? {};
    const oppHand = state.hands[-me as Side] ?? {};
    SHOGI_HAND_PIECES.forEach((piece, k) => {
      out[SQUARES + k] = myHand[piece] ?? 0;
      out[SQUARES + SHOGI_HAND_PIECES.length + k] = oppHand[piece] ?? 0;
    });
    return out;
  },

  encodeLegalActions: (state, playerId) => {
    // getLegalActions は MOVE / DROP しか返さない（投了・入玉宣言は学習対象外）
    const me = resolveSide(state, playerId);
    return ShogiRuleset.getLegalActions(state, playerId).map((a) => encodeShogiAction(a, me));
  },

  decodeAction: (state, actionId, playerId) => {
    if (!Number.isInteger(actionId) || actionId < 0 || actionId >= SHOGI_N_ACTIONS) {
      throw new Error(`Invalid Shogi actionId: ${actionId} (expected 0..${SHOGI_N_ACTIONS - 1})`);
    }
    const me = resolveSide(state, playerId);
    const toP = Math.floor(actionId / SHOGI_ACTION_KINDS);
    const kind = actionId % SHOGI_ACTION_KINDS;
    const to = toPerspective(toP, me);

    if (kind >= DROP_OFFSET) {
      return { type: "DROP", to, piece: SHOGI_HAND_PIECES[kind - DROP_OFFSET], playerId };
    }

    const promote = kind >= PROMOTE_OFFSET;
    const direction = kind % PROMOTE_OFFSET;
    const [dx, dy] = MOVE_DIRECTIONS[direction];
    const [tx, ty] = toXY(toP);

    // 移動元: 移動先から方向を逆にたどって最初に駒があるマス（桂は 1 マスだけ）
    let x = tx - dx;
    let y = ty - dy;
    let from = -1;
    while (inBounds(x, y)) {
      const i = toPerspective(toI(x, y), me);
      if ((state.board[i] ?? 0) !== 0) {
        from = i;
        break;
      }
      if (direction >= KNIGHT_DIRECTION_START) break;
      x -= dx;
      y -= dy;
    }
    if (from < 0) {
      throw new Error(`Invalid Shogi actionId: ${actionId} (no piece can move to square ${to})`);
    }
    return { type: "MOVE", from, to, promote, playerId };
  },
};
