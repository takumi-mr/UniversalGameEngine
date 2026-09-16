import type { BaseGameState, BaseGameAction, GameRuleset } from "../GameRules";
import type { IGameRNG } from "../utils/IGameRNG";

// --- 定数定義 ---
const PIECES = {
  FU: 1,
  KY: 2,
  KE: 3,
  GI: 4,
  KI: 5,
  KA: 6,
  HI: 7,
  OU: 8,
  TO: 9,
  NY: 10,
  NK: 11,
  NG: 12,
  UM: 13,
  RY: 14,
};

// 持ち駒になった時に元の駒に戻すためのマッピング
const DEMOTE_MAP: Record<number, number> = {
  9: 1,
  10: 2,
  11: 3,
  12: 4,
  13: 6,
  14: 7,
};

// 成った時の駒のマッピング
const PROMOTE_MAP: Record<number, number> = {
  1: 9,
  2: 10,
  3: 11,
  4: 12,
  6: 13,
  7: 14,
};

// 駒の動きの定義（先手基準。dx: X軸, dy: Y軸）
// step: 1マスだけ動ける方向 / slide: 遮るものがない限りどこまでも動ける方向
const MOVE_DEFS: Record<number, { step?: number[][]; slide?: number[][] }> = {
  1: { step: [[0, -1]] }, // 歩
  2: { slide: [[0, -1]] }, // 香
  3: {
    step: [
      [-1, -2],
      [1, -2],
    ],
  }, // 桂
  4: {
    step: [
      [0, -1],
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ],
  }, // 銀
  5: {
    step: [
      [0, -1],
      [-1, -1],
      [1, -1],
      [-1, 0],
      [1, 0],
      [0, 1],
    ],
  }, // 金
  6: {
    slide: [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ],
  }, // 角
  7: {
    slide: [
      [0, -1],
      [0, 1],
      [-1, 0],
      [1, 0],
    ],
  }, // 飛
  8: {
    step: [
      [0, -1],
      [-1, -1],
      [1, -1],
      [-1, 0],
      [1, 0],
      [0, 1],
      [-1, 1],
      [1, 1],
    ],
  }, // 玉
  // 成り駒（金と同じ動き）
  9: {
    step: [
      [0, -1],
      [-1, -1],
      [1, -1],
      [-1, 0],
      [1, 0],
      [0, 1],
    ],
  },
  10: {
    step: [
      [0, -1],
      [-1, -1],
      [1, -1],
      [-1, 0],
      [1, 0],
      [0, 1],
    ],
  },
  11: {
    step: [
      [0, -1],
      [-1, -1],
      [1, -1],
      [-1, 0],
      [1, 0],
      [0, 1],
    ],
  },
  12: {
    step: [
      [0, -1],
      [-1, -1],
      [1, -1],
      [-1, 0],
      [1, 0],
      [0, 1],
    ],
  },
  // 馬と龍
  13: {
    slide: [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ],
    step: [
      [0, -1],
      [0, 1],
      [-1, 0],
      [1, 0],
    ],
  },
  14: {
    slide: [
      [0, -1],
      [0, 1],
      [-1, 0],
      [1, 0],
    ],
    step: [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ],
  },
};

const initialBoard = [
  -2, -3, -4, -5, -8, -5, -4, -3, -2, 0, -7, 0, 0, 0, 0, 0, -6, 0, -1, -1, -1, -1, -1, -1, -1, -1,
  -1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1,
  1, 1, 1, 1, 1, 0, 6, 0, 0, 0, 0, 0, 7, 0, 2, 3, 4, 5, 8, 5, 4, 3, 2,
];

// --- ヘルパー関数群 ---
const toXY = (i: number) => [i % 9, Math.floor(i / 9)];
const toI = (x: number, y: number) => y * 9 + x;
const inBounds = (x: number, y: number) => x >= 0 && x < 9 && y >= 0 && y < 9;

// 敵陣（成りが発生するゾーン）にいるか
const isPromotionZone = (y: number, turn: number) => (turn === 1 ? y <= 2 : y >= 6);

export interface ShogiState extends BaseGameState {
  board: number[];
  turn: number;
  hands: {
    1: Record<number, number>;
    "-1": Record<number, number>;
  };
  /** 投了した側（1: 先手 / -1: 後手） */
  resignedBy?: number;
}

export type ShogiActionType = "MOVE" | "DROP" | "RESIGN";

export interface ShogiAction extends BaseGameAction {
  type: ShogiActionType;
  from?: number;
  to?: number;
  piece?: number;
  promote?: boolean;
}

type Side = 1 | -1;

// 盤面上の駒の移動可能範囲を生成（疑似合法手。自玉への王手は考慮しない）
function generateMoves(board: number[], fromIndex: number): number[] {
  const pieceVal = board[fromIndex];
  if (pieceVal === 0) return [];

  const turn = Math.sign(pieceVal);
  const type = Math.abs(pieceVal);
  const [x, y] = toXY(fromIndex);
  const def = MOVE_DEFS[type];
  const moves: number[] = [];

  // Step移動の計算
  if (def.step) {
    for (const [dx, dy] of def.step) {
      // 先手・後手でY軸の進行方向を反転させる
      const nx = x + dx;
      const ny = y + dy * turn;
      if (inBounds(nx, ny)) {
        const target = board[toI(nx, ny)];
        // 空のマスか、敵の駒なら移動可能
        if (target === 0 || Math.sign(target) !== turn) {
          moves.push(toI(nx, ny));
        }
      }
    }
  }

  // Slide移動の計算（飛車・角・香車）
  if (def.slide) {
    for (const [dx, dy] of def.slide) {
      let nx = x + dx;
      let ny = y + dy * turn;
      while (inBounds(nx, ny)) {
        const target = board[toI(nx, ny)];
        if (target === 0) {
          moves.push(toI(nx, ny));
        } else {
          // 敵の駒にぶつかったらそこまでは移動可能。その後は進めない。
          if (Math.sign(target) !== turn) {
            moves.push(toI(nx, ny));
          }
          break;
        }
        nx += dx;
        ny += dy * turn;
      }
    }
  }
  return moves;
}

/** side の玉がいる位置（無ければ -1） */
function findKing(board: number[], side: Side): number {
  return board.indexOf(PIECES.OU * side);
}

/** index のマスが bySide の駒に利いているか */
function isAttacked(board: number[], index: number, bySide: Side): boolean {
  for (let i = 0; i < 81; i++) {
    const v = board[i];
    if (v === 0 || Math.sign(v) !== bySide) continue;
    if (generateMoves(board, i).includes(index)) return true;
  }
  return false;
}

/** side の玉に王手がかかっているか（玉が無い場合は false） */
export function isInCheck(board: number[], side: Side): boolean {
  const king = findKing(board, side);
  return king !== -1 && isAttacked(board, king, -side as Side);
}

/** 手を盤面に適用した結果の盤面（手番は変えない） */
function applyToBoard(board: number[], action: ShogiAction, turn: Side): number[] {
  const next = [...board];
  if (action.type === "MOVE") {
    const pieceVal = next[action.from!];
    next[action.from!] = 0;
    next[action.to!] = action.promote ? PROMOTE_MAP[Math.abs(pieceVal)] * turn : pieceVal;
  } else if (action.type === "DROP") {
    next[action.to!] = turn * action.piece!;
  }
  return next;
}

/** 行き所のない駒になるか（歩・香は最終段、桂は最終 2 段） */
function isDeadSquare(pieceType: number, toY: number, turn: Side): boolean {
  if (pieceType === PIECES.FU || pieceType === PIECES.KY) return turn === 1 ? toY === 0 : toY === 8;
  if (pieceType === PIECES.KE) return turn === 1 ? toY <= 1 : toY >= 7;
  return false;
}

/** 二歩になるか */
function isNifu(board: number[], x: number, turn: Side): boolean {
  for (let y = 0; y < 9; y++) {
    if (board[toI(x, y)] === PIECES.FU * turn) return true;
  }
  return false;
}

/**
 * turn 側の疑似合法手（王手放置・打ち歩詰めは除外しない）。
 * 成れる場合は「成る」「成らない」の両方を生成し、強制成りは成る手だけ生成する。
 */
function generatePseudoActions(state: ShogiState, turn: Side): ShogiAction[] {
  const actions: ShogiAction[] = [];
  const { board } = state;

  // 1. 盤上の駒の移動 (MOVE)
  for (let i = 0; i < 81; i++) {
    const pieceVal = board[i];
    if (pieceVal === 0 || Math.sign(pieceVal) !== turn) continue;

    const type = Math.abs(pieceVal);
    const [, fromY] = toXY(i);

    for (const to of generateMoves(board, i)) {
      const [, toY] = toXY(to);
      const canPromote =
        !!PROMOTE_MAP[type] && (isPromotionZone(fromY, turn) || isPromotionZone(toY, turn));
      const mustPromote = isDeadSquare(type, toY, turn);

      if (canPromote) actions.push({ type: "MOVE", from: i, to, promote: true });
      if (!mustPromote) actions.push({ type: "MOVE", from: i, to, promote: false });
    }
  }

  // 2. 持ち駒の打つ手 (DROP)
  for (const [pieceStr, count] of Object.entries(state.hands[turn])) {
    if (!count) continue;
    const pieceType = parseInt(pieceStr, 10);

    for (let i = 0; i < 81; i++) {
      if (board[i] !== 0) continue;
      const [x, y] = toXY(i);
      if (isDeadSquare(pieceType, y, turn)) continue;
      if (pieceType === PIECES.FU && isNifu(board, x, turn)) continue;
      actions.push({ type: "DROP", to: i, piece: pieceType });
    }
  }

  return actions;
}

/** 指した後に自玉が取られる形（王手放置・自殺手）になるか */
function leavesKingInCheck(state: ShogiState, action: ShogiAction, turn: Side): boolean {
  return isInCheck(applyToBoard(state.board, action, turn), turn);
}

/** turn 側に合法手が 1 つでもあるか（打ち歩詰めの再帰判定用に、打ち歩詰め自体は考慮しない） */
function hasLegalMove(state: ShogiState, turn: Side): boolean {
  return generatePseudoActions(state, turn).some((a) => !leavesKingInCheck(state, a, turn));
}

/** 打ち歩詰め: 歩を打って王手し、相手に合法手が無い */
function isUchifuzume(state: ShogiState, action: ShogiAction, turn: Side): boolean {
  if (action.type !== "DROP" || action.piece !== PIECES.FU) return false;
  const board = applyToBoard(state.board, action, turn);
  const opponent = -turn as Side;
  if (!isInCheck(board, opponent)) return false;
  return !hasLegalMove({ ...state, board }, opponent);
}

/** turn 側の完全な合法手 */
export function generateLegalActions(state: ShogiState, turn: Side): ShogiAction[] {
  return generatePseudoActions(state, turn).filter(
    (a) => !leavesKingInCheck(state, a, turn) && !isUchifuzume(state, a, turn),
  );
}

/** action.playerId がどちらの側か（着席していなければ null。誰も着席していないテスト用の状態では手番側） */
function sideOf(state: ShogiState, playerId?: string): Side | null {
  const players = state.players ?? {};
  if (playerId !== undefined && players[1] === playerId) return 1;
  if (playerId !== undefined && players[-1] === playerId) return -1;
  if (players[1] == null && players[-1] == null) return state.turn as Side;
  return null;
}

export const ShogiRuleset: GameRuleset<ShogiState, ShogiAction> = {
  getInitialState: (_options?: any, _rng?: IGameRNG): ShogiState => ({
    status: "WAITING",
    turn: 1,
    board: [...initialBoard],
    hands: { 1: {}, "-1": {} },
    players: { 1: null, "-1": null },
    activePlayers: [],
  }),

  isValidAction: (state, action) => {
    if (state.status !== "PLAYING") return false;
    const turn = state.turn as Side;

    if (action.type === "RESIGN") return sideOf(state, action.playerId) !== null;

    // 手番のプレイヤーか
    if (sideOf(state, action.playerId) !== turn) return false;

    if (action.type === "MOVE") {
      if (action.from === undefined || action.to === undefined) return false;
      const pieceVal = state.board[action.from];
      if (pieceVal === 0 || Math.sign(pieceVal) !== turn) return false;

      // 移動範囲のチェック
      if (!generateMoves(state.board, action.from).includes(action.to)) return false;

      // 成りのバリデーション（行き所のない駒は強制成り）
      const type = Math.abs(pieceVal);
      const [, fromY] = toXY(action.from);
      const [, toY] = toXY(action.to);
      const canPromote =
        !!PROMOTE_MAP[type] && (isPromotionZone(fromY, turn) || isPromotionZone(toY, turn));
      if (action.promote && !canPromote) return false;
      if (!action.promote && isDeadSquare(type, toY, turn)) return false;

      // 王手放置・自殺手
      return !leavesKingInCheck(state, action, turn);
    }

    if (action.type === "DROP") {
      if (!action.piece || !state.hands[turn][action.piece]) return false;
      if (action.to === undefined || state.board[action.to] !== 0) return false;

      const [toX, toY] = toXY(action.to);
      if (action.piece === PIECES.FU && isNifu(state.board, toX, turn)) return false;
      if (isDeadSquare(action.piece, toY, turn)) return false;
      if (leavesKingInCheck(state, action, turn)) return false;
      return !isUchifuzume(state, action, turn);
    }

    return false;
  },

  reduce: (state, action, _rng?: IGameRNG) => {
    const newState: ShogiState = {
      ...state,
      board: [...state.board],
      hands: {
        1: { ...state.hands[1] },
        "-1": { ...state.hands["-1"] },
      },
    };
    const turn = state.turn as Side;

    if (action.type === "RESIGN") {
      const side = sideOf(state, action.playerId) ?? turn;
      newState.resignedBy = side;
      newState.status = "FINISHED";
      newState.message = `${side === 1 ? "Sente" : "Gote"} Resigned`;
      newState.activePlayers = [];
      return newState;
    }

    if (action.type === "MOVE") {
      const targetVal = newState.board[action.to!];
      // 駒を取る処理（成り駒は元の駒に降格させる）
      if (targetVal !== 0) {
        const capturedType = Math.abs(targetVal);
        const demoted = DEMOTE_MAP[capturedType] || capturedType;
        newState.hands[turn][demoted] = (newState.hands[turn][demoted] || 0) + 1;
      }
      newState.board = applyToBoard(newState.board, action, turn);
      newState.turn = -turn;
    }

    if (action.type === "DROP") {
      newState.board = applyToBoard(newState.board, action, turn);
      newState.hands[turn][action.piece!]--;
      newState.turn = -turn;
    }

    newState.activePlayers = newState.players?.[newState.turn as Side]
      ? [newState.players[newState.turn as Side]!]
      : [];
    return newState;
  },

  checkWinCondition: (state) => {
    const winnerOf = (side: Side, message: string) => {
      const winnerId = state.players?.[side];
      return { isFinished: true, winnerIds: winnerId ? [winnerId] : [], message };
    };

    // 投了
    if (state.resignedBy) {
      const winner = -state.resignedBy as Side;
      return winnerOf(winner, `${winner === 1 ? "Sente" : "Gote"} Wins by resignation`);
    }

    // 玉が取られている（合法手のみを通していれば起きないが、保険として）
    if (!state.board.includes(PIECES.OU)) return winnerOf(-1, "Gote Wins");
    if (!state.board.includes(-PIECES.OU)) return winnerOf(1, "Sente Wins");

    // 手番側に合法手が無ければ負け（詰み。将棋ではステイルメイトも負け）
    if (state.status === "PLAYING") {
      const turn = state.turn as Side;
      if (!hasLegalMove(state, turn)) {
        const winner = -turn as Side;
        const how = isInCheck(state.board, turn) ? "Checkmate" : "No legal moves";
        return winnerOf(winner, `${winner === 1 ? "Sente" : "Gote"} Wins (${how})`);
      }
    }
    return { isFinished: false };
  },

  getLegalActions: (state, playerId) => {
    if (state.status !== "PLAYING") return [];
    const turn = state.turn as Side;
    if (sideOf(state, playerId) !== turn) return [];
    return generateLegalActions(state, turn).map((a) => ({ ...a, playerId }));
  },
};
