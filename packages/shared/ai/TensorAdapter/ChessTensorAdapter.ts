// packages/shared/ai/TensorAdapter/ChessTensorAdapter.ts
import type { IAITensorAdapter } from "@engine/shared/ai/IAITensorAdapter";
import { ChessRuleset, PROMOTION_PIECES } from "@engine/shared/rules/ChessRuleset";
import type { ChessState, ChessAction } from "@engine/shared/rules/ChessRuleset";

type Side = 1 | -1;

const BOARD_SIZE = 8;
const SQUARES = BOARD_SIZE * BOARD_SIZE;

/**
 * 観測の長さ: 盤面 64 + キャスリング権 4（自分 K / 自分 Q / 相手 K / 相手 Q）
 * + アンパッサン対象マス 1（自分視点の index、なければ -1）+ 50 手ルールのカウンタ 1 + 現局面の同形回数 1
 */
export const CHESS_OBS_DIM = SQUARES + 4 + 1 + 1 + 1;
const CASTLING_OFFSET = SQUARES;
const EN_PASSANT_OFFSET = CASTLING_OFFSET + 4;
const HALF_MOVES_OFFSET = EN_PASSANT_OFFSET + 1;
const REPETITION_OFFSET = HALF_MOVES_OFFSET + 1;

/**
 * 移動方向（自分視点。自分のポーンは y が小さくなる方向へ進む）。
 * 0: 上, 1: 左上, 2: 右上, 3: 左, 4: 右, 5: 下, 6: 左下, 7: 右下
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
];
/** ナイトの移動（8 通り）。種別 8-15 */
const KNIGHT_OFFSETS: readonly (readonly [number, number])[] = [
  [-1, -2],
  [1, -2],
  [-2, -1],
  [2, -1],
  [-2, 1],
  [2, 1],
  [-1, 2],
  [1, 2],
];
/** 昇格するポーンの移動方向（上 / 左上 / 右上 = MOVE_DIRECTIONS の 0-2） */
const PROMOTION_DIRECTIONS = 3;
const KNIGHT_OFFSET = MOVE_DIRECTIONS.length;
const PROMOTION_OFFSET = KNIGHT_OFFSET + KNIGHT_OFFSETS.length;

/**
 * 移動先マスごとの行動種別数。
 * 0-7: 移動方向（クイーン・ルーク・ビショップ・キング・ポーンの前進と捕獲・キャスリング）
 * 8-15: ナイトの移動 / 16-27: ポーンの昇格（方向 3 × 駒種 4: Q R B N）
 */
export const CHESS_ACTION_KINDS = PROMOTION_OFFSET + PROMOTION_DIRECTIONS * PROMOTION_PIECES.length;

/** 行動空間の大きさ（64 マス × 28 種 = 1792） */
export const CHESS_N_ACTIONS = SQUARES * CHESS_ACTION_KINDS;

const toXY = (i: number): [number, number] => [i % BOARD_SIZE, Math.floor(i / BOARD_SIZE)];
const toI = (x: number, y: number) => y * BOARD_SIZE + x;
const inBounds = (x: number, y: number) => x >= 0 && x < BOARD_SIZE && y >= 0 && y < BOARD_SIZE;

/**
 * 盤面のマス index を「自分視点」の index に変換する（逆変換も同じ関数）。
 * 黒は盤を上下に反転して、常に自分の駒が上（y=0 方向）へ進む座標系にする。
 * 180 度回転ではなく上下反転にするのは、キングサイド / クイーンサイドの左右を白と揃えるため
 * （キャスリングが両者とも「右へ 2 マス = キングサイド」になる）。
 */
const toPerspective = (index: number, side: Side) => {
  if (side === 1) return index;
  const [x, y] = toXY(index);
  return toI(x, BOARD_SIZE - 1 - y);
};

/**
 * playerId がどちらの側かを返す。
 * 未着席（players が空）の場合は現在の手番の側とみなす（ルールセットの sideOf と同じ扱い）。
 */
function resolveSide(state: ChessState, playerId: string): Side {
  if (state.players?.[1] === playerId) return 1;
  if (state.players?.[-1] === playerId) return -1;
  return state.turn;
}

/**
 * MOVE を actionId に変換する（自分視点の座標で符号化する）。
 *
 * 移動は「移動先 + 方向」で表す。移動元は、移動先から方向を逆にたどって最初にぶつかる駒なので一意に復元できる
 * （スライド駒は途中に駒があれば越えられない。ポーンの 2 歩前進とキャスリングも間のマスが空なので同じ）。
 * ナイトと昇格は移動元が 1 マス手前で決まる。
 */
export function encodeChessAction(action: ChessAction, side: Side): number {
  if (action.type !== "MOVE" || action.from === undefined || action.to === undefined) {
    throw new Error(`Cannot encode Chess action of type ${action.type}`);
  }
  const [fx, fy] = toXY(toPerspective(action.from, side));
  const toP = toPerspective(action.to, side);
  const [tx, ty] = toXY(toP);
  const dx = tx - fx;
  const dy = ty - fy;

  if (action.promotion !== undefined) {
    const slot = PROMOTION_PIECES.indexOf(action.promotion);
    if (slot < 0) throw new Error(`Cannot promote to piece type ${action.promotion}`);
    const direction = MOVE_DIRECTIONS.slice(0, PROMOTION_DIRECTIONS).findIndex(
      ([ddx, ddy]) => ddx === dx && ddy === dy,
    );
    if (direction < 0) throw new Error(`Not a promotion move: ${action.from} -> ${action.to}`);
    return toP * CHESS_ACTION_KINDS + PROMOTION_OFFSET + direction * PROMOTION_PIECES.length + slot;
  }

  const knight = KNIGHT_OFFSETS.findIndex(([ddx, ddy]) => ddx === dx && ddy === dy);
  if (knight >= 0) return toP * CHESS_ACTION_KINDS + KNIGHT_OFFSET + knight;

  const sx = Math.sign(dx);
  const sy = Math.sign(dy);
  const straight = dx === 0 || dy === 0 || Math.abs(dx) === Math.abs(dy);
  const direction = MOVE_DIRECTIONS.findIndex(([ddx, ddy]) => ddx === sx && ddy === sy);
  if (!straight || direction < 0) {
    throw new Error(`Not a straight Chess move: ${action.from} -> ${action.to}`);
  }
  return toP * CHESS_ACTION_KINDS + direction;
}

/**
 * チェス用テンソルアダプタ。
 *
 * - encodeState: 71 個の数値。先頭 64 個は自分視点（黒は上下反転）の盤面で、
 *   自分の駒 = +駒種（1〜6: P N B R Q K）、相手の駒 = -駒種、空 = 0。
 *   続く 4 個がキャスリング権（自分 K / 自分 Q / 相手 K / 相手 Q、0 か 1）、
 *   次がアンパッサンの対象マス（自分視点の index。なければ -1）、50 手ルールのカウンタ（半手数）、
 *   最後が現局面がこれまでに現れた回数（1〜3。3 で引き分け）。
 * - actionId: 移動先マス（自分視点）× 28 + 種別。種別は 0-7 が移動方向、8-15 がナイト、
 *   16-27 が昇格（方向 上/左上/右上 × 駒種 Q/R/B/N）。0 〜 1791。
 */
export const ChessTensorAdapter: IAITensorAdapter<ChessState, ChessAction> = {
  encodeState: (state, playerId) => {
    const me = resolveSide(state, playerId);
    const out: number[] = new Array(CHESS_OBS_DIM).fill(0);
    for (let i = 0; i < SQUARES; i++) {
      const v = state.board[i] ?? 0;
      if (v === 0) continue;
      out[toPerspective(i, me)] = Math.sign(v) === me ? Math.abs(v) : -Math.abs(v);
    }
    const c = state.castling;
    const [myK, myQ, oppK, oppQ] = me === 1 ? [c.wK, c.wQ, c.bK, c.bQ] : [c.bK, c.bQ, c.wK, c.wQ];
    out[CASTLING_OFFSET] = myK ? 1 : 0;
    out[CASTLING_OFFSET + 1] = myQ ? 1 : 0;
    out[CASTLING_OFFSET + 2] = oppK ? 1 : 0;
    out[CASTLING_OFFSET + 3] = oppQ ? 1 : 0;
    out[EN_PASSANT_OFFSET] = state.enPassant === null ? -1 : toPerspective(state.enPassant, me);
    out[HALF_MOVES_OFFSET] = state.halfMoves;
    const history = state.positionHistory ?? [];
    const current = history[history.length - 1];
    out[REPETITION_OFFSET] = current ? history.filter((k) => k === current).length : 1;
    return out;
  },

  encodeLegalActions: (state, playerId) => {
    // getLegalActions は MOVE しか返さない（投了は学習対象外）
    const me = resolveSide(state, playerId);
    return ChessRuleset.getLegalActions(state, playerId).map((a) => encodeChessAction(a, me));
  },

  decodeAction: (state, actionId, playerId) => {
    if (!Number.isInteger(actionId) || actionId < 0 || actionId >= CHESS_N_ACTIONS) {
      throw new Error(`Invalid Chess actionId: ${actionId} (expected 0..${CHESS_N_ACTIONS - 1})`);
    }
    const me = resolveSide(state, playerId);
    const toP = Math.floor(actionId / CHESS_ACTION_KINDS);
    const kind = actionId % CHESS_ACTION_KINDS;
    const to = toPerspective(toP, me);
    const [tx, ty] = toXY(toP);

    if (kind >= PROMOTION_OFFSET) {
      const k = kind - PROMOTION_OFFSET;
      const [dx, dy] = MOVE_DIRECTIONS[Math.floor(k / PROMOTION_PIECES.length)];
      if (!inBounds(tx - dx, ty - dy)) {
        throw new Error(`Invalid Chess actionId: ${actionId} (promotion source is off the board)`);
      }
      const from = toPerspective(toI(tx - dx, ty - dy), me);
      const promotion = PROMOTION_PIECES[k % PROMOTION_PIECES.length];
      return { type: "MOVE", from, to, promotion, playerId };
    }

    if (kind >= KNIGHT_OFFSET) {
      const [dx, dy] = KNIGHT_OFFSETS[kind - KNIGHT_OFFSET];
      if (!inBounds(tx - dx, ty - dy)) {
        throw new Error(`Invalid Chess actionId: ${actionId} (knight source is off the board)`);
      }
      return { type: "MOVE", from: toPerspective(toI(tx - dx, ty - dy), me), to, playerId };
    }

    // 移動元: 移動先から方向を逆にたどって最初に駒があるマス
    const [dx, dy] = MOVE_DIRECTIONS[kind];
    let x = tx - dx;
    let y = ty - dy;
    while (inBounds(x, y)) {
      const i = toPerspective(toI(x, y), me);
      if ((state.board[i] ?? 0) !== 0) return { type: "MOVE", from: i, to, playerId };
      x -= dx;
      y -= dy;
    }
    throw new Error(`Invalid Chess actionId: ${actionId} (no piece can move to square ${to})`);
  },
};
