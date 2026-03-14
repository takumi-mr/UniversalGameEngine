// packages/shared/rules/HighLowRuleset.ts
import type { GameRuleset, BaseGameState, BaseGameAction } from '../UniversalEngine';

// --- 1. ドメイン（トランプ特有）の型定義 ---
export type Suit = '♠' | '♥' | '♦' | '♣';
export type PlayerId = 1 | 2;

export interface Card {
    suit: Suit;
    rank: number; // 1(A) ~ 13(K)
}

// --- 2. 状態とアクションの型定義 ---
export interface HighLowState extends BaseGameState {
    deck: Card[];                     // 山札
    currentTurn: PlayerId;            // 現在のターン
    field: Record<PlayerId, Card | null>; // 場に出たカード
    scores: Record<PlayerId, number>; // スコア
    round: number;                    // 現在のラウンド数
}

export interface DrawAction extends BaseGameAction {
    type: 'DRAW';
    player: PlayerId;
}

// --- 3. ヘルパー関数: シャッフルされた山札を作る ---
function createDeck(): Card[] {
    const suits: Suit[] = ['♠', '♥', '♦', '♣'];
    const deck: Card[] = [];
    for (const suit of suits) {
        for (let rank = 1; rank <= 13; rank++) {
            deck.push({ suit, rank });
        }
    }
    // フィッシャー–イェーツのシャッフル
    for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
}

// --- 4. ルールセット本体 ---
export const HighLowRuleset: GameRuleset<HighLowState, DrawAction> = {
    getInitialState: () => {
        return {
            status: 'PLAYING',
            message: 'Game Start! Player 1, draw a card.',
            deck: createDeck(),
            currentTurn: 1,
            field: { 1: null, 2: null },
            scores: { 1: 0, 2: 0 },
            round: 1
        };
    },

    isValidAction: (state, action) => {
        if (state.status !== 'PLAYING') return false;
        if (action.type !== 'DRAW') return false;
        if (action.player !== state.currentTurn) return false;
        if (state.deck.length === 0) return false;
        return true;
    },

    reduce: (state, action) => {
        // イミュータブルな更新（浅いコピーと深いコピーを組み合わせる）
        const newState: HighLowState = {
            ...state,
            deck: [...state.deck],
            field: { ...state.field },
            scores: { ...state.scores }
        };

        // 山札から1枚引いて場に出す
        const drawnCard = newState.deck.pop()!;
        newState.field[action.player] = drawnCard;

        if (action.player === 1) {
            // Player 1 が引いた後は、Player 2 のターン
            newState.currentTurn = 2;
            newState.message = `Player 1 drew a card. Player 2's turn!`;
        } else {
            // Player 2 が引いた後（両者がカードを出した状態）で判定を行う
            const p1Card = newState.field[1]!;
            const p2Card = newState.field[2]!;
            let roundWinner: PlayerId | null = null;

            if (p1Card.rank > p2Card.rank) {
                roundWinner = 1;
                newState.scores[1]++;
            } else if (p2Card.rank > p1Card.rank) {
                roundWinner = 2;
                newState.scores[2]++;
            }

            // 次のラウンドへ準備
            newState.round++;
            newState.field = { 1: null, 2: null };
            newState.currentTurn = 1;

            if (roundWinner) {
                newState.message = `Round ${newState.round - 1}: Player ${roundWinner} wins! (P1: ${p1Card.suit}${p1Card.rank} vs P2: ${p2Card.suit}${p2Card.rank})`;
            } else {
                newState.message = `Round ${newState.round - 1}: Draw! (Both drew ${p1Card.rank})`;
            }
        }

        return newState;
    },

    checkWinCondition: (state) => {
        // どちらかが3ポイント先取したらゲーム終了
        if (state.scores[1] >= 3) {
            return { isFinished: true, message: 'Game Over: Player 1 Wins the Match!' };
        }
        if (state.scores[2] >= 3) {
            return { isFinished: true, message: 'Game Over: Player 2 Wins the Match!' };
        }
        // 山札が尽きたら引き分け
        if (state.deck.length < 2) {
            return { isFinished: true, message: 'Game Over: Deck Out, Draw Game!' };
        }

        return { isFinished: false };
    },

    getLegalActions: (state, playerId) => {
        if (state.status !== 'PLAYING') return [];
        
        const turn = state.currentTurn;
        if (state.players && state.players[turn] !== null && state.players[turn] !== playerId) {
            return [];
        }

        const action: DrawAction = { type: 'DRAW', player: turn, playerId };
        if (HighLowRuleset.isValidAction(state, action)) {
            return [action];
        }

        return [];
    }
};