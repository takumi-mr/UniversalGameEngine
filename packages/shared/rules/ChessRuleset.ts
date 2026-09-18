// packages/shared/rules/ChessRuleset.ts
import type { BaseGameState, BaseGameAction, GameRuleset } from "@engine/shared/GameRules";
import type { IGameRNG } from "@engine/shared/utils/IGameRNG";

// --- 定数定義 ---
// 1: Pawn, 2: Knight, 3: Bishop, 4: Rook, 5: Queen, 6: King
export const PIECES = { P: 1, N: 2, B: 3, R: 4, Q: 5, K: 6 };

export interface ChessState extends BaseGameState {
  board: number[];
  turn: 1 | -1; // 1: White(白), -1: Black(黒)
  // キャスリングの権利
  castling: {
    wK: boolean;
    wQ: boolean; // 白のキングサイド、クイーンサイド
    bK: boolean;
    bQ: boolean; // 黒のキングサイド、クイーンサイド
  };
  enPassant: number | null; // アンパッサンのターゲットマスのインデックス
  halfMoves: number; // 50手ルール用（ポーンの移動または捕獲でリセット）
  fullMoves: number; // ターン数
  /** 三回同形判定用の局面履歴（盤面・手番・キャスリング権・アンパッサン）。初期局面を含む */
  positionHistory?: string[];
  /** 投了した側 */
  resignedBy?: 1 | -1;
}

export interface ChessAction extends BaseGameAction {
  type: "MOVE" | "RESIGN";
  from?: number;
  to?: number;
  promotion?: number; // 昇格する場合の駒種（N/B/R/Q のいずれか。通常は 5: Queen）
}

/** 昇格できる駒種 */
export const PROMOTION_PIECES = [PIECES.Q, PIECES.R, PIECES.B, PIECES.N];
/** 同一局面がこの回数現れたら引き分け */
export const REPETITION_LIMIT = 3;

// 初期配置 (白は正の数、黒は負の数。上が黒陣、下が白陣)
const INITIAL_BOARD = [
  -4,
  -2,
  -3,
  -5,
  -6,
  -3,
  -2,
  -4, // Black back rank
  -1,
  -1,
  -1,
  -1,
  -1,
  -1,
  -1,
  -1, // Black pawns
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  1,
  1,
  1,
  1,
  1,
  1,
  1,
  1, // White pawns
  4,
  2,
  3,
  5,
  6,
  3,
  2,
  4, // White back rank
];

// 座標ヘルパー
const toX = (i: number) => i % 8;
const toY = (i: number) => Math.floor(i / 8);
const toI = (x: number, y: number) => y * 8 + x;
const inBounds = (x: number, y: number) => x >= 0 && x < 8 && y >= 0 && y < 8;

// 方向ベクトル
const DIRS = {
  N: [
    [-1, -2],
    [1, -2],
    [-2, -1],
    [2, -1],
    [-2, 1],
    [2, 1],
    [-1, 2],
    [1, 2],
  ], // Knight
  B: [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ], // Bishop (斜め)
  R: [
    [0, -1],
    [0, 1],
    [-1, 0],
    [1, 0],
  ], // Rook (縦横)
  Q: [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
    [0, -1],
    [0, 1],
    [-1, 0],
    [1, 0],
  ], // Queen/King
};

// --- 盤面計算ヘルパー ---

// 指定マスが敵から攻撃されているか（チェック・キャスリング判定用）
function isAttacked(board: number[], targetIndex: number, attackerColor: number): boolean {
  const tx = toX(targetIndex);
  const ty = toY(targetIndex);

  // ポーンによる攻撃
  const pawnDir = attackerColor === 1 ? 1 : -1; // 白(1)は上から下へ攻撃する視点(Y軸増加方向)
  for (const dx of [-1, 1]) {
    if (inBounds(tx + dx, ty + pawnDir)) {
      if (board[toI(tx + dx, ty + pawnDir)] === PIECES.P * attackerColor) return true;
    }
  }

  // ナイトによる攻撃
  for (const [dx, dy] of DIRS.N) {
    if (inBounds(tx + dx, ty + dy) && board[toI(tx + dx, ty + dy)] === PIECES.N * attackerColor)
      return true;
  }

  // キングによる攻撃 (隣接マス)
  for (const [dx, dy] of DIRS.Q) {
    if (inBounds(tx + dx, ty + dy) && board[toI(tx + dx, ty + dy)] === PIECES.K * attackerColor)
      return true;
  }

  // スライド駒（ルーク、ビショップ、クイーン）による攻撃
  const checkSlide = (dirs: number[][], piece1: number, piece2: number) => {
    for (const [dx, dy] of dirs) {
      let cx = tx + dx,
        cy = ty + dy;
      while (inBounds(cx, cy)) {
        const p = board[toI(cx, cy)];
        if (p !== 0) {
          if (p === piece1 * attackerColor || p === piece2 * attackerColor) return true;
          break; // 味方の駒か、関係ない敵駒に遮られた
        }
        cx += dx;
        cy += dy;
      }
    }
    return false;
  };
  if (checkSlide(DIRS.R, PIECES.R, PIECES.Q)) return true;
  if (checkSlide(DIRS.B, PIECES.B, PIECES.Q)) return true;

  return false;
}

// 疑似合法手（チェックを考慮しない物理的な移動可能マス）を生成
function generatePseudoMoves(state: ChessState, from: number): number[] {
  const piece = state.board[from];
  if (piece === 0) return [];

  const color = Math.sign(piece);
  const type = Math.abs(piece);
  const x = toX(from);
  const y = toY(from);
  const moves: number[] = [];

  const addIfValid = (nx: number, ny: number) => {
    if (inBounds(nx, ny)) {
      const target = state.board[toI(nx, ny)];
      if (target === 0 || Math.sign(target) !== color) moves.push(toI(nx, ny));
      return target === 0; // スライド継続可能か
    }
    return false;
  };

  // スライド駒 (R, B, Q)
  if (type === PIECES.R || type === PIECES.B || type === PIECES.Q) {
    const dirs = type === PIECES.R ? DIRS.R : type === PIECES.B ? DIRS.B : DIRS.Q;
    for (const [dx, dy] of dirs) {
      let nx = x + dx,
        ny = y + dy;
      while (addIfValid(nx, ny)) {
        nx += dx;
        ny += dy;
      }
    }
  }

  // ナイト (N) と キング (K)
  if (type === PIECES.N) DIRS.N.forEach(([dx, dy]) => addIfValid(x + dx, y + dy));
  if (type === PIECES.K) {
    DIRS.Q.forEach(([dx, dy]) => addIfValid(x + dx, y + dy));

    // キャスリング
    const enemyColor = color * -1;
    if (color === 1) {
      // 白
      if (state.castling.wK && state.board[61] === 0 && state.board[62] === 0) {
        if (!isAttacked(state.board, 60, enemyColor) && !isAttacked(state.board, 61, enemyColor))
          moves.push(62);
      }
      if (
        state.castling.wQ &&
        state.board[59] === 0 &&
        state.board[58] === 0 &&
        state.board[57] === 0
      ) {
        if (!isAttacked(state.board, 60, enemyColor) && !isAttacked(state.board, 59, enemyColor))
          moves.push(58);
      }
    } else {
      // 黒
      if (state.castling.bK && state.board[5] === 0 && state.board[6] === 0) {
        if (!isAttacked(state.board, 4, enemyColor) && !isAttacked(state.board, 5, enemyColor))
          moves.push(6);
      }
      if (
        state.castling.bQ &&
        state.board[3] === 0 &&
        state.board[2] === 0 &&
        state.board[1] === 0
      ) {
        if (!isAttacked(state.board, 4, enemyColor) && !isAttacked(state.board, 3, enemyColor))
          moves.push(2);
      }
    }
  }

  // ポーン (P)
  if (type === PIECES.P) {
    const dir = color === 1 ? -1 : 1; // 白は上(Y減)、黒は下(Y増)
    const startY = color === 1 ? 6 : 1;

    // 1歩前進
    if (inBounds(x, y + dir) && state.board[toI(x, y + dir)] === 0) {
      moves.push(toI(x, y + dir));
      // 2歩前進 (初期位置のみ)
      if (y === startY && state.board[toI(x, y + dir * 2)] === 0) {
        moves.push(toI(x, y + dir * 2));
      }
    }
    // 斜め前への捕獲
    for (const dx of [-1, 1]) {
      if (inBounds(x + dx, y + dir)) {
        const targetIdx = toI(x + dx, y + dir);
        const target = state.board[targetIdx];
        if ((target !== 0 && Math.sign(target) !== color) || state.enPassant === targetIdx) {
          moves.push(targetIdx);
        }
      }
    }
  }

  return moves;
}

// 王手(チェック)を回避している「真の合法手」かを検証
function isStrictlyLegal(state: ChessState, from: number, to: number): boolean {
  const tempState = ChessRuleset.reduce!(state, {
    type: "MOVE",
    from,
    to,
  } as ChessAction);
  const kingIndex = tempState.board.indexOf(PIECES.K * state.turn);
  // 自分が動いたあとの盤面で、自分のキングが相手から攻撃されていなければ合法
  return !isAttacked(tempState.board, kingIndex, state.turn * -1);
}

/** 局面（盤面・手番・キャスリング権・アンパッサン）を同一性判定用の文字列にする */
export function positionKey(
  state: Pick<ChessState, "board" | "turn" | "castling" | "enPassant">,
): string {
  const c = state.castling;
  const rights = `${c.wK ? "K" : ""}${c.wQ ? "Q" : ""}${c.bK ? "k" : ""}${c.bQ ? "q" : ""}`;
  return `${state.board.join(",")}|${state.turn}|${rights}|${state.enPassant ?? "-"}`;
}

/** side のキングがチェックされているか */
export function isInCheck(board: number[], side: 1 | -1): boolean {
  const king = board.indexOf(PIECES.K * side);
  return king !== -1 && isAttacked(board, king, -side);
}

/**
 * どちらもメイトできない駒構成（デッドポジション）か。
 * K vs K / K+B vs K / K+N vs K / K+B vs K+B（同色マスのビショップ）を引き分けとする
 */
export function isInsufficientMaterial(board: number[]): boolean {
  const minors: { type: number; squareColor: number }[] = [];
  for (let i = 0; i < 64; i++) {
    const v = board[i];
    if (v === 0) continue;
    const type = Math.abs(v);
    if (type === PIECES.K) continue;
    if (type === PIECES.P || type === PIECES.R || type === PIECES.Q) return false;
    minors.push({ type, squareColor: (toX(i) + toY(i)) % 2 });
  }
  if (minors.length <= 1) return true;
  if (minors.length === 2 && minors.every((m) => m.type === PIECES.B)) {
    return minors[0].squareColor === minors[1].squareColor;
  }
  return false;
}

/** action.playerId がどちらの側か（着席していなければ null。誰も着席していなければ手番側） */
function sideOf(state: ChessState, playerId?: string): 1 | -1 | null {
  const players = state.players ?? {};
  if (playerId !== undefined && players[1] === playerId) return 1;
  if (playerId !== undefined && players[-1] === playerId) return -1;
  if (players[1] == null && players[-1] == null) return state.turn;
  return null;
}

// --- ルールセット本体 ---

export const ChessRuleset: GameRuleset<ChessState, ChessAction> = {
  getInitialState: (_options?: any, _rng?: IGameRNG): ChessState => ({
    status: "WAITING",
    board: [...INITIAL_BOARD],
    turn: 1,
    castling: { wK: true, wQ: true, bK: true, bQ: true },
    enPassant: null,
    halfMoves: 0,
    fullMoves: 1,
    players: { 1: null, "-1": null },
    activePlayers: [],
    positionHistory: [
      positionKey({
        board: INITIAL_BOARD,
        turn: 1,
        castling: { wK: true, wQ: true, bK: true, bQ: true },
        enPassant: null,
      }),
    ],
  }),

  isValidAction: (state, action) => {
    if (state.status !== "PLAYING") return false;
    if (action.type === "RESIGN") return sideOf(state, action.playerId) !== null;
    if (action.type !== "MOVE") return false;
    if (action.from === undefined || action.to === undefined) return false;

    const piece = state.board[action.from];
    if (piece === 0 || Math.sign(piece) !== state.turn) return false;

    // 手番プレイヤーチェック
    if (sideOf(state, action.playerId) !== state.turn) return false;

    // 1. 疑似合法手の中に含まれているか
    const pseudoMoves = generatePseudoMoves(state, action.from);
    if (!pseudoMoves.includes(action.to)) return false;

    // 2. 自分のキングがチェックされる自殺手ではないか
    if (!isStrictlyLegal(state, action.from, action.to)) return false;

    // プロモーションのチェック（一番奥の段に到達したポーン）
    const isPawn = Math.abs(piece) === PIECES.P;
    const toYloc = toY(action.to);
    const isPromotionRank =
      (state.turn === 1 && toYloc === 0) || (state.turn === -1 && toYloc === 7);
    if (isPawn && isPromotionRank) {
      return action.promotion !== undefined && PROMOTION_PIECES.includes(action.promotion);
    }

    return true;
  },

  reduce: (state, action, _rng?: IGameRNG) => {
    const newState: ChessState = JSON.parse(JSON.stringify(state));

    if (action.type === "RESIGN") {
      const side = sideOf(state, action.playerId) ?? state.turn;
      newState.resignedBy = side;
      newState.status = "FINISHED";
      newState.message = `${side === 1 ? "White" : "Black"} resigned`;
      newState.activePlayers = [];
      return newState;
    }
    if (action.from === undefined || action.to === undefined) return newState;

    const piece = newState.board[action.from];
    const target = newState.board[action.to];
    const isPawn = Math.abs(piece) === PIECES.P;

    // --- 盤面の更新 ---
    newState.board[action.from] = 0;
    newState.board[action.to] = piece;

    // 50手ルールのカウンタ更新
    if (isPawn || target !== 0) newState.halfMoves = 0;
    else newState.halfMoves++;

    // アンパッサンの処理（斜めに動いたのにターゲットマスが空だった場合）
    if (isPawn && action.to === state.enPassant) {
      const captureDir = state.turn === 1 ? 1 : -1;
      newState.board[toI(toX(action.to), toY(action.to) + captureDir)] = 0;
    }

    // 次のターンのためのアンパッサンマス設定（ポーンの2歩移動）
    newState.enPassant = null;
    if (isPawn && Math.abs(toY(action.from) - toY(action.to)) === 2) {
      const epDir = state.turn === 1 ? -1 : 1;
      newState.enPassant = toI(toX(action.from), toY(action.from) + epDir);
    }

    // プロモーション（昇格）
    if (
      isPawn &&
      ((state.turn === 1 && toY(action.to) === 0) || (state.turn === -1 && toY(action.to) === 7))
    ) {
      newState.board[action.to] = (action.promotion || PIECES.Q) * state.turn;
    }

    // キャスリングの処理（ルークの強制移動）
    if (Math.abs(piece) === PIECES.K) {
      if (action.from === 60 && action.to === 62) {
        newState.board[63] = 0;
        newState.board[61] = PIECES.R;
      } // 白Kサイド
      if (action.from === 60 && action.to === 58) {
        newState.board[56] = 0;
        newState.board[59] = PIECES.R;
      } // 白Qサイド
      if (action.from === 4 && action.to === 6) {
        newState.board[7] = 0;
        newState.board[5] = -PIECES.R;
      } // 黒Kサイド
      if (action.from === 4 && action.to === 2) {
        newState.board[0] = 0;
        newState.board[3] = -PIECES.R;
      } // 黒Qサイド
    }

    // キャスリング権利の喪失
    if (piece === PIECES.K) {
      newState.castling.wK = false;
      newState.castling.wQ = false;
    }
    if (piece === -PIECES.K) {
      newState.castling.bK = false;
      newState.castling.bQ = false;
    }
    if (action.from === 63 || action.to === 63) newState.castling.wK = false;
    if (action.from === 56 || action.to === 56) newState.castling.wQ = false;
    if (action.from === 7 || action.to === 7) newState.castling.bK = false;
    if (action.from === 0 || action.to === 0) newState.castling.bQ = false;

    // ターン交代
    if (newState.turn === -1) newState.fullMoves++;
    newState.turn = (newState.turn * -1) as 1 | -1;
    newState.activePlayers = newState.players?.[newState.turn]
      ? [newState.players[newState.turn]!]
      : [];
    newState.positionHistory = [...(state.positionHistory ?? []), positionKey(newState)];

    return newState;
  },

  checkWinCondition: (state) => {
    // 投了
    if (state.resignedBy) {
      const winner = -state.resignedBy as 1 | -1;
      const winnerId = state.players?.[winner];
      return {
        isFinished: true,
        winnerIds: winnerId ? [winnerId] : [],
        message: `${winner === 1 ? "White" : "Black"} wins by resignation.`,
      };
    }

    // 全合法手を生成し、1つでもあればまだプレイ続行
    const hasLegalMoves = (() => {
      for (let i = 0; i < 64; i++) {
        if (state.board[i] !== 0 && Math.sign(state.board[i]) === state.turn) {
          const pseudoMoves = generatePseudoMoves(state, i);
          if (pseudoMoves.some((to) => isStrictlyLegal(state, i, to))) return true;
        }
      }
      return false;
    })();

    if (!hasLegalMoves) {
      const kingIndex = state.board.indexOf(PIECES.K * state.turn);
      const isCheck = isAttacked(state.board, kingIndex, state.turn * -1);
      if (isCheck) {
        // チェックメイト
        const winnerKey = (state.turn * -1) as 1 | -1;
        const winnerId = state.players?.[winnerKey];
        return {
          isFinished: true,
          winnerIds: winnerId ? [winnerId] : [],
          message: `Checkmate! ${state.turn === 1 ? "Black" : "White"} wins.`,
        };
      } else {
        // ステイルメイト（王手されていないが動かせる駒がない）
        return { isFinished: true, winnerIds: [], message: "Stalemate. Draw." };
      }
    }

    // 50手ルールによる引き分け
    if (state.halfMoves >= 100) {
      return { isFinished: true, winnerIds: [], message: "Draw by 50-move rule." };
    }

    // 三回同形
    const history = state.positionHistory ?? [];
    const current = history[history.length - 1];
    if (current && history.filter((k) => k === current).length >= REPETITION_LIMIT) {
      return { isFinished: true, winnerIds: [], message: "Draw by threefold repetition." };
    }

    // メイトできない駒構成
    if (isInsufficientMaterial(state.board)) {
      return { isFinished: true, winnerIds: [], message: "Draw by insufficient material." };
    }

    return { isFinished: false };
  },

  getLegalActions: (state, playerId) => {
    if (state.status !== "PLAYING") return [];
    if (sideOf(state, playerId) !== state.turn) return [];

    const actions: ChessAction[] = [];
    for (let i = 0; i < 64; i++) {
      const piece = state.board[i];
      if (piece !== 0 && Math.sign(piece) === state.turn) {
        const pseudoMoves = generatePseudoMoves(state, i);

        for (const to of pseudoMoves) {
          if (isStrictlyLegal(state, i, to)) {
            const isPromotion =
              Math.abs(piece) === PIECES.P &&
              ((state.turn === 1 && toY(to) === 0) || (state.turn === -1 && toY(to) === 7));
            if (isPromotion) {
              // プロモーションは4種類の駒を選択可能
              PROMOTION_PIECES.forEach((promo) => {
                actions.push({
                  type: "MOVE",
                  from: i,
                  to,
                  promotion: promo,
                  playerId,
                });
              });
            } else {
              actions.push({ type: "MOVE", from: i, to, playerId });
            }
          }
        }
      }
    }
    return actions;
  },
};
