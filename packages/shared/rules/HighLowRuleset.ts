// packages/shared/rules/HighLowRuleset.ts
import type { GameRuleset, BaseGameState } from "../GameRules";
import type { IGameRNG } from "../utils/IGameRNG";

// --- 1. ドメイン（トランプ特有）の型定義 ---
export type Suit = "♠" | "♥" | "♦" | "♣";
export type PlayerId = 1 | 2;

export interface Card {
  suit: Suit;
  rank: number; // 1(A) ~ 13(K)
}

// --- 2. 状態とアクションの型定義 ---
export interface HighLowState extends BaseGameState {
  deck: Card[]; // 山札
  currentTurn: PlayerId; // 現在のターン
  baseCard: Card | null; // 基準となるカード
  lastGuess: "HIGH" | "LOW" | null; // 直前の予想
  lastResultCard: Card | null; // 直前に引いたカード
  scores: Record<PlayerId, number>; // スコア
  round: number; // 現在のラウンド数
}

export type HighLowAction =
  | { type: "GUESS"; choice: "HIGH" | "LOW"; playerId?: string }
  | { type: "START"; playerId?: string };

// --- 3. ヘルパー関数: シャッフルされた山札を作る ---
function createDeck(rng?: IGameRNG): Card[] {
  const suits: Suit[] = ["♠", "♥", "♦", "♣"];
  const deck: Card[] = [];
  for (const suit of suits) {
    for (let rank = 1; rank <= 13; rank++) {
      deck.push({ suit, rank });
    }
  }
  // フィッシャー–イェーツのシャッフル
  for (let i = deck.length - 1; i > 0; i--) {
    const j = rng ? rng.nextInt(0, i) : Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

const getRankLabel = (rank: number) => {
  if (rank === 1) return "A";
  if (rank === 11) return "J";
  if (rank === 12) return "Q";
  if (rank === 13) return "K";
  return rank.toString();
};

// --- 4. ルールセット本体 ---
export const HighLowRuleset: GameRuleset<HighLowState, HighLowAction> = {
  getInitialState: (_options?: any, _rng?: IGameRNG) => {
    return {
      status: "WAITING",
      message: "Waiting for players...",
      deck: [],
      currentTurn: 1,
      baseCard: null,
      lastGuess: null,
      lastResultCard: null,
      scores: { 1: 0, 2: 0 },
      round: 1,
      players: { 1: null, 2: null },
    };
  },

  isValidAction: (state, action) => {
    if (action.type === "START") {
      return (
        state.status === "WAITING" && Object.values(state.players || {}).filter(Boolean).length >= 1
      );
    }

    if (state.status !== "PLAYING") return false;
    if (action.type !== "GUESS") return false;

    // ターンプレイヤーチェック
    const turn = state.currentTurn;
    if (state.players && state.players[turn] && state.players[turn] !== action.playerId) {
      return false;
    }

    if (state.deck.length === 0) return false;
    return true;
  },

  reduce: (state, action, rng?: IGameRNG) => {
    if (action.type === "START") {
      const deck = createDeck(rng);
      const baseCard = deck.pop()!;
      return {
        ...state,
        status: "PLAYING",
        deck,
        baseCard,
        message: `Game Started! Base card is ${baseCard.suit}${getRankLabel(baseCard.rank)}. Player 1's turn!`,
        activePlayers: state.players
          ? state.players[1] || state.players["1"]
            ? [state.players[1] || state.players["1"]]
            : []
          : [],
      };
    }

    if (action.type !== "GUESS") return state;

    const newState: HighLowState = {
      ...state,
      deck: [...state.deck],
      scores: { ...state.scores },
    };

    const resultCard = newState.deck.pop()!;
    const baseCard = state.baseCard!;

    newState.lastGuess = action.choice;
    newState.lastResultCard = resultCard;

    let isCorrect = false;
    if (action.choice === "HIGH") {
      isCorrect = resultCard.rank > baseCard.rank;
    } else {
      isCorrect = resultCard.rank < baseCard.rank;
    }

    if (isCorrect) {
      newState.scores[state.currentTurn]++;
      newState.message = `Correct! ${resultCard.suit}${getRankLabel(resultCard.rank)} was ${action.choice}er than ${baseCard.suit}${getRankLabel(baseCard.rank)}.`;
    } else if (resultCard.rank === baseCard.rank) {
      newState.message = `Draw! Both were ${getRankLabel(resultCard.rank)}.`;
    } else {
      newState.message = `Wrong! ${resultCard.suit}${getRankLabel(resultCard.rank)} was not ${action.choice}er than ${baseCard.suit}${getRankLabel(baseCard.rank)}.`;
    }

    // 次の準備
    newState.baseCard = resultCard;
    newState.round++;
    const nextTurn = (state.currentTurn === 1 ? 2 : 1) as PlayerId;
    newState.currentTurn = nextTurn;

    // 手番プレイヤーのIDを設定（AIの自動実行に必要）
    const nextPlayerId = newState.players
      ? newState.players[nextTurn] || newState.players[nextTurn.toString() as any]
      : null;
    newState.activePlayers = nextPlayerId ? [nextPlayerId] : [];

    return newState;
  },

  checkWinCondition: (state) => {
    // 先に5ポイント取ったら勝ち
    if (state.scores[1] >= 5) {
      return {
        isFinished: true,
        winnerIds: state.players?.[1] ? [state.players[1]!] : [],
        message: "Player 1 Wins!",
      };
    }
    if (state.scores[2] >= 5) {
      return {
        isFinished: true,
        winnerIds: state.players?.[2] ? [state.players[2]!] : [],
        message: "Player 2 Wins!",
      };
    }
    // 山札切れ
    if (state.deck.length === 0) {
      const p1 = state.scores[1];
      const p2 = state.scores[2];
      const winners = [];
      if (p1 >= p2 && state.players?.[1]) winners.push(state.players[1]!);
      if (p2 >= p1 && state.players?.[2]) winners.push(state.players[2]!);
      return {
        isFinished: true,
        winnerIds: winners,
        message: "Deck out! Game finished.",
      };
    }
    return { isFinished: false };
  },

  applyWinResult: (state, winResult) => ({
    ...state,
    status: "FINISHED",
    message: winResult.message,
    activePlayers: [],
  }),

  getLegalActions: (state, playerId) => {
    if (state.status === "WAITING") {
      const action: HighLowAction = { type: "START", playerId };
      if (HighLowRuleset.isValidAction(state, action)) return [action];
      return [];
    }

    if (state.status !== "PLAYING") return [];

    const turn = state.currentTurn;
    const currentPlayerId = state.players
      ? state.players[turn] || state.players[turn.toString() as any]
      : null;
    if (currentPlayerId && currentPlayerId !== playerId) {
      return [];
    }

    return [
      { type: "GUESS", choice: "HIGH", playerId },
      { type: "GUESS", choice: "LOW", playerId },
    ];
  },
};
