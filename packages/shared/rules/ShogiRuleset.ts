import type { BaseGameState, BaseGameAction, GameRuleset } from "../GameRules";
import type { IGameRNG } from "../utils/IGameRNG";

// --- 定数定義 ---
const PIECES = {
  FU: 1, KY: 2, KE: 3, GI: 4, KI: 5, KA: 6, HI: 7, OU: 8,
  TO: 9, NY: 10, NK: 11, NG: 12, UM: 13, RY: 14
};

// 持ち駒になった時に元の駒に戻すためのマッピング
const DEMOTE_MAP: Record<number, number> = {
  9: 1, 10: 2, 11: 3, 12: 4, 13: 6, 14: 7
};

// 成った時の駒のマッピング
const PROMOTE_MAP: Record<number, number> = {
  1: 9, 2: 10, 3: 11, 4: 12, 6: 13, 7: 14
};

// 駒の動きの定義（先手基準。dx: X軸, dy: Y軸）
// step: 1マスだけ動ける方向 / slide: 遮るものがない限りどこまでも動ける方向
const MOVE_DEFS: Record<number, { step?: number[][], slide?: number[][] }> = {
  1: { step: [[0, -1]] }, // 歩
  2: { slide: [[0, -1]] }, // 香
  3: { step: [[-1, -2], [1, -2]] }, // 桂
  4: { step: [[0, -1], [-1, -1], [1, -1], [-1, 1], [1, 1]] }, // 銀
  5: { step: [[0, -1], [-1, -1], [1, -1], [-1, 0], [1, 0], [0, 1]] }, // 金
  6: { slide: [[-1, -1], [1, -1], [-1, 1], [1, 1]] }, // 角
  7: { slide: [[0, -1], [0, 1], [-1, 0], [1, 0]] }, // 飛
  8: { step: [[0, -1], [-1, -1], [1, -1], [-1, 0], [1, 0], [0, 1], [-1, 1], [1, 1]] }, // 玉
  // 成り駒（金と同じ動き）
  9: { step: [[0, -1], [-1, -1], [1, -1], [-1, 0], [1, 0], [0, 1]] },
  10: { step: [[0, -1], [-1, -1], [1, -1], [-1, 0], [1, 0], [0, 1]] },
  11: { step: [[0, -1], [-1, -1], [1, -1], [-1, 0], [1, 0], [0, 1]] },
  12: { step: [[0, -1], [-1, -1], [1, -1], [-1, 0], [1, 0], [0, 1]] },
  // 馬と龍
  13: { slide: [[-1, -1], [1, -1], [-1, 1], [1, 1]], step: [[0, -1], [0, 1], [-1, 0], [1, 0]] },
  14: { slide: [[0, -1], [0, 1], [-1, 0], [1, 0]], step: [[-1, -1], [1, -1], [-1, 1], [1, 1]] }
};

const initialBoard = [
  -2, -3, -4, -5, -8, -5, -4, -3, -2,
  0, -7, 0, 0, 0, 0, 0, -6, 0,
  -1, -1, -1, -1, -1, -1, -1, -1, -1,
  0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0,
  1, 1, 1, 1, 1, 1, 1, 1, 1,
  0, 6, 0, 0, 0, 0, 0, 7, 0,
  2, 3, 4, 5, 8, 5, 4, 3, 2
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
}

export type ShogiActionType = "MOVE" | "DROP" | "RESIGN";

export interface ShogiAction extends BaseGameAction {
  type: ShogiActionType;
  from?: number;
  to?: number;
  piece?: number;
  promote?: boolean;
}

// 盤面上の駒の移動可能範囲を生成（疑似合法手）
function generateMoves(state: ShogiState, fromIndex: number): number[] {
  const pieceVal = state.board[fromIndex];
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
        const target = state.board[toI(nx, ny)];
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
        const target = state.board[toI(nx, ny)];
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

export const ShogiRuleset: GameRuleset<ShogiState, ShogiAction> = {
  getInitialState: (options?: any, rng?: IGameRNG): ShogiState => ({
    status: "WAITING",
    turn: 1,
    board: [...initialBoard],
    hands: { 1: {}, "-1": {} },
    players: { 1: null, "-1": null }
  }),

  isValidAction: (state, action) => {
    if (state.status !== "PLAYING") return false;
    if (action.type === "RESIGN") return true;

    // プレイヤーの番かどうかをチェック
    if (state.players && state.players[state.turn as 1 | -1] !== action.playerId) return false;

    if (action.type === "MOVE") {
      if (action.from === undefined || action.to === undefined) return false;
      const pieceVal = state.board[action.from];
      if (pieceVal === 0 || Math.sign(pieceVal) !== state.turn) return false;

      // 移動範囲のチェック
      const validMoves = generateMoves(state, action.from);
      if (!validMoves.includes(action.to)) return false;

      // 成りのバリデーション
      const type = Math.abs(pieceVal);
      const [_, fromY] = toXY(action.from);
      const [__, toY] = toXY(action.to);
      const canPromote = !!PROMOTE_MAP[type] && (isPromotionZone(fromY, state.turn) || isPromotionZone(toY, state.turn));

      // 行き所のない駒の判定（強制成り）
      // 歩・香は1段目、桂馬は2段目に進むと成らなければならない
      let mustPromote = false;
      if (type === PIECES.FU || type === PIECES.KY) mustPromote = (state.turn === 1 ? toY === 0 : toY === 8);
      if (type === PIECES.KE) mustPromote = (state.turn === 1 ? toY <= 1 : toY >= 7);

      if (action.promote && !canPromote) return false;
      if (!action.promote && mustPromote) return false;

      return true;
    }

    if (action.type === "DROP") {
      if (!action.piece || !state.hands[state.turn as 1 | -1][action.piece]) return false;
      if (action.to === undefined || state.board[action.to] !== 0) return false;

      const [toX, toY] = toXY(action.to);

      // 二歩（にふ）のチェック
      if (action.piece === PIECES.FU) {
        for (let y = 0; y < 9; y++) {
          if (state.board[toI(toX, y)] === PIECES.FU * state.turn) return false;
        }
      }

      // 打ち歩詰めは今回は簡略化のため省略（本格実装時は王手判定ロジックが必要）

      // 行き所のない駒のチェック
      if (action.piece === PIECES.FU || action.piece === PIECES.KY) {
        if (state.turn === 1 && toY === 0) return false;
        if (state.turn === -1 && toY === 8) return false;
      }
      if (action.piece === PIECES.KE) {
        if (state.turn === 1 && toY <= 1) return false;
        if (state.turn === -1 && toY >= 7) return false;
      }

      return true;
    }

    return false;
  },

  reduce: (state, action, rng?: IGameRNG) => {
    const newState: ShogiState = {
      ...state,
      board: [...state.board],
      hands: {
        1: { ...state.hands[1] },
        "-1": { ...state.hands["-1"] }
      }
    };

    if (action.type === "RESIGN") {
      newState.status = "FINISHED";
      newState.message = `${state.turn === 1 ? 'Sente' : 'Gote'} Resigned`;
      return newState;
    }

    if (action.type === "MOVE") {
      const pieceVal = newState.board[action.from!];
      const targetVal = newState.board[action.to!];

      // 駒を取る処理
      if (targetVal !== 0) {
        const owner = newState.turn as 1 | -1;
        const capturedType = Math.abs(targetVal);
        // 成り駒は元の駒に降格させる
        const demoted = DEMOTE_MAP[capturedType] || capturedType;
        newState.hands[owner][demoted] = (newState.hands[owner][demoted] || 0) + 1;
      }

      newState.board[action.from!] = 0;

      // 成る処理
      if (action.promote) {
        newState.board[action.to!] = PROMOTE_MAP[Math.abs(pieceVal)] * newState.turn;
      } else {
        newState.board[action.to!] = pieceVal;
      }

      newState.turn *= -1;
    }

    if (action.type === "DROP") {
      const owner = newState.turn as 1 | -1;
      newState.board[action.to!] = owner * action.piece!;
      newState.hands[owner][action.piece!]--;
      newState.turn *= -1;
    }

    return newState;
  },

  checkWinCondition: (state) => {
    // 簡易的な勝敗判定（王が取られたら終了）。
    // 厳密な将棋は「王を取る合法手が存在する状態（詰み）」で判定しますが、
    // エンジンとして動かす分にはこの疑似判定でも十分に機能します。
    const king1 = state.board.includes(PIECES.OU);
    const king2 = state.board.includes(-PIECES.OU);

    if (!king1) {
      const winnerId = state.players?.["-1"];
      return { isFinished: true, winnerIds: winnerId ? [winnerId] : [], message: "Gote Wins" };
    }
    if (!king2) {
      const winnerId = state.players?.["1"];
      return { isFinished: true, winnerIds: winnerId ? [winnerId] : [], message: "Sente Wins" };
    }
    return { isFinished: false };
  },

  getLegalActions: (state, playerId) => {
    if (state.status !== "PLAYING") return [];
    const actions: ShogiAction[] = [];
    const turn = state.turn as 1 | -1;

    // 1. 盤上の駒の移動 (MOVE)
    for (let i = 0; i < 81; i++) {
      const pieceVal = state.board[i];
      if (pieceVal === 0 || Math.sign(pieceVal) !== turn) continue;

      const type = Math.abs(pieceVal);
      const moves = generateMoves(state, i);
      const [_, fromY] = toXY(i);

      for (const to of moves) {
        const [__, toY] = toXY(to);
        const canPromote = !!PROMOTE_MAP[type] && (isPromotionZone(fromY, turn) || isPromotionZone(toY, turn));

        let mustPromote = false;
        if (type === PIECES.FU || type === PIECES.KY) mustPromote = (turn === 1 ? toY === 0 : toY === 8);
        if (type === PIECES.KE) mustPromote = (turn === 1 ? toY <= 1 : toY >= 7);

        // 成れる場合は「成る手」と「成らない手」両方を生成
        if (canPromote && !mustPromote) {
          actions.push({ type: "MOVE", from: i, to, promote: true, playerId });
          actions.push({ type: "MOVE", from: i, to, promote: false, playerId });
        } else if (mustPromote) {
          actions.push({ type: "MOVE", from: i, to, promote: true, playerId });
        } else {
          actions.push({ type: "MOVE", from: i, to, promote: false, playerId });
        }
      }
    }

    // 2. 持ち駒の打つ手 (DROP)
    for (const [pieceStr, count] of Object.entries(state.hands[turn])) {
      if (count === 0) continue;
      const pieceType = parseInt(pieceStr, 10);

      for (let i = 0; i < 81; i++) {
        if (state.board[i] !== 0) continue;

        const [x, y] = toXY(i);

        // 行き所のないマスの除外
        if ((pieceType === PIECES.FU || pieceType === PIECES.KY) && (turn === 1 ? y === 0 : y === 8)) continue;
        if (pieceType === PIECES.KE && (turn === 1 ? y <= 1 : y >= 7)) continue;

        // 二歩の除外
        if (pieceType === PIECES.FU) {
          let nifu = false;
          for (let cy = 0; cy < 9; cy++) {
            if (state.board[toI(x, cy)] === PIECES.FU * turn) {
              nifu = true;
              break;
            }
          }
          if (nifu) continue;
        }

        actions.push({ type: "DROP", to: i, piece: pieceType, playerId });
      }
    }

    // （厳密にはここで「自玉に王手がかかる手」をフィルタリングする処理が入りますが、
    // ボリュームが膨大になるため、AI・エンジン用として疑似合法手として返しています）

    return actions;
  }
};