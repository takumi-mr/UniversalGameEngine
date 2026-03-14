// packages/shared/rules/TexasHoldemRules.ts
import type { BaseGameState, BaseGameAction, GameRuleset } from '../UniversalEngine';

// ポーカー特有の状態定義
export interface TexasHoldemState extends BaseGameState {
    deck: string[];           // 山札
    communityCards: string[]; // コミュニティカード (フロップ、ターン、リバー)
    hands: Record<string, string[]>; // 各プレイヤーごとの手札（ユーザーIDがキー）
    pot: number;              // 現在の総ポット額
    currentBet: number;       // 現在のラウンドでの最高ベット額
    playerBets: Record<string, number>; // 各プレイヤーがこのラウンドでベットした額
    playerChips: Record<string, number>; // 各プレイヤーの所持チップ額
    foldedPlayers: string[];  // フォールドしたプレイヤーのIDリスト
    phase: 'PRE_FLOP' | 'FLOP' | 'TURN' | 'RIVER' | 'SHOWDOWN'; // 現在のフェーズ
    dealerIndex: number;      // ディーラー（ボタン）のインデックス
    playerIds: string[];      // 参加プレイヤーのID順序リスト
}

// ポーカー特有のアクション定義
export interface TexasHoldemAction extends BaseGameAction {
    type: 'FOLD' | 'CHECK' | 'CALL' | 'RAISE';
    amount?: number; // RAISE の場合のレイズ額
}

// 簡易的なデッキ生成関数（実際にはスートとランクを持つオブジェクト配列が望ましい）
function createDeck(): string[] {
    const suits = ['H', 'D', 'C', 'S']; // Hearts, Diamonds, Clubs, Spades
    const ranks = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
    const deck: string[] = [];
    for (const suit of suits) {
        for (const rank of ranks) {
            deck.push(`${rank}${suit}`);
        }
    }
    return deck.sort(() => Math.random() - 0.5); // 簡易的なシャッフル
}

export const TexasHoldemRuleset: GameRuleset<TexasHoldemState, TexasHoldemAction> = {
    getInitialState: (options: any) => {
        const opts = options || {};
        const playerIds = (opts.playerIds || []).filter((id: any) => !!id);
        const initialChips = opts.initialChips || 1000;
        const deck = createDeck();
        const hands: Record<string, string[]> = {};
        const playerChips: Record<string, number> = {};
        const playerBets: Record<string, number> = {};

        // 各プレイヤーにチップを配り、初期設定
        if (playerIds.length > 0) {
            for (const pId of playerIds) {
                playerChips[pId] = initialChips;
                playerBets[pId] = 0;
                // 2枚ずつ配る
                hands[pId] = [deck.pop()!, deck.pop()!];
            }
        }

        return {
            status: 'WAITING',
            players: playerIds.length > 0
                ? playerIds.reduce((acc: Record<string, string>, p: string) => ({ ...acc, [p]: p }), {})
                : { 1: null, 2: null, 3: null, 4: null, 5: null, 6: null }, // Default 6 slots
            activePlayers: playerIds.length > 0 ? [playerIds[0]] : [],
            playerIds,
            deck,
            communityCards: [],
            hands,
            pot: 0,
            currentBet: 0,
            playerBets,
            playerChips,
            foldedPlayers: [],
            phase: 'PRE_FLOP',
            dealerIndex: 0
        };
    },

    isValidAction: (state: TexasHoldemState, action: TexasHoldemAction) => {
        if (state.status !== 'PLAYING') return false;
        
        // アクティブなプレイヤーからの（手番の）アクションか？
        if (!state.activePlayers || !state.activePlayers.includes(action.playerId!)) return false;

        const pId = action.playerId!;
        
        // フォールド済みのプレイヤーは行動できない
        if (state.foldedPlayers.includes(pId)) return false;

        const playerChips = state.playerChips[pId];
        const playerCurrentBet = state.playerBets[pId];
        const callAmount = state.currentBet - playerCurrentBet;

        switch (action.type) {
            case 'FOLD':
                return true;
            case 'CHECK':
                // コール額が0（つまり現在最高ベット額に追いついている）場合のみチェック可能
                return callAmount === 0;
            case 'CALL':
                // チップがコール額以上あること
                // （オールインは簡略化のため今回は考慮外とするか、全額コールできるかチェックが必要）
                return playerChips >= callAmount;
            case 'RAISE':
                // レイズ額が存在し、コール額＋レイズ額以上のチップを持っていること
                if (!action.amount || action.amount <= 0) return false;
                return playerChips >= (callAmount + action.amount);
            default:
                return false;
        }
    },

    reduce: (state: TexasHoldemState, action: TexasHoldemAction) => {
        const newState = { ...state };
        const pId = action.playerId!;
        const playerChips = newState.playerChips[pId];
        const playerCurrentBet = newState.playerBets[pId];
        const callAmount = newState.currentBet - playerCurrentBet;

        switch (action.type) {
            case 'FOLD':
                newState.foldedPlayers.push(pId);
                break;
            case 'CHECK':
                // 何もしない
                break;
            case 'CALL':
                newState.playerChips[pId] -= callAmount;
                newState.playerBets[pId] += callAmount;
                newState.pot += callAmount;
                break;
            case 'RAISE':
                const raiseAmount = action.amount!;
                const totalAmount = callAmount + raiseAmount;
                newState.playerChips[pId] -= totalAmount;
                newState.playerBets[pId] += totalAmount;
                newState.pot += totalAmount;
                newState.currentBet += raiseAmount;
                break;
        }

        // 次のプレイヤーを探すロジック（簡略化：全員が現在ベット額に追いつくかフォールドするまで回る）
        // 完全なフェーズ進行（PRE_FLOP -> FLOPなど）ロジックは非常に複雑なため、
        // 今回のサンプルでは「1ターン進める」部分のインターフェース例を示します。

        // 次の生きてるプレイヤーへ手番を移す
        let nextIdx = (newState.playerIds.indexOf(pId) + 1) % newState.playerIds.length;
        // 簡易的な無限ループ防止策（全員フォールド時は後述のwinCheckを通る）
        while (newState.foldedPlayers.includes(newState.playerIds[nextIdx])) {
            nextIdx = (nextIdx + 1) % newState.playerIds.length;
        }
        newState.activePlayers = [newState.playerIds[nextIdx]];

        return newState;
    },

    checkWinCondition: (state: TexasHoldemState) => {
        // 全員フォールドして残り1人になったらゲーム終了
        const activeCount = state.playerIds.length - state.foldedPlayers.length;
        if (activeCount <= 1) {
            return {
                isFinished: true,
                message: `Game over. Player won by fold.`
            };
        }
        
        // 本当は `SHOWDOWN` フェーズでの役判定ロジックなどが必要だが簡略化
        if (state.phase === 'SHOWDOWN') {
            return {
                isFinished: true,
                message: `Game over. Showdown.`
            };
        }

        return { isFinished: false };
    },

    // 隠匿情報（自分以外の他人の手札）をマスクするフック！
    maskState: (state: TexasHoldemState, targetPlayerId: string): TexasHoldemState => {
        const maskedHands: Record<string, string[]> = {};
        
        for (const [pId, hand] of Object.entries(state.hands)) {
            if (pId === targetPlayerId) {
                // 自分の手札はそのまま見せる
                maskedHands[pId] = hand;
            } else {
                // 他人の手札は "?" にして裏向きカードとして扱う
                maskedHands[pId] = hand.map(() => '?');
            }
        }

        const maskedState: TexasHoldemState = {
            ...state,
            hands: maskedHands,
            // 山札の中身も絶対に送信してはいけないので全マスクまたは空配列にする
            deck: state.deck.map(() => '?') 
        };

        return maskedState;
    },

    applyWinResult: (state, winResult) => {
        const newState = structuredClone(state);
        newState.status = 'FINISHED';
        newState.activePlayers = [];

        // フォールド勝ち: 残った一人がポットをすべて獲得
        const activePlayers = newState.playerIds.filter(id => !newState.foldedPlayers.includes(id));
        if (activePlayers.length === 1) {
            const winner = activePlayers[0];
            newState.playerChips[winner] = (newState.playerChips[winner] ?? 0) + newState.pot;
            newState.pot = 0;
            newState.message = `${winner} wins the pot of ${newState.pot} chips! (Others folded)`;
        } else {
            // SHOWDOWN ケース: 本来は手の強さ判定が必要だが、ここでは均等分配で簡略化
            const share = Math.floor(newState.pot / activePlayers.length);
            for (const pid of activePlayers) {
                newState.playerChips[pid] = (newState.playerChips[pid] ?? 0) + share;
            }
            newState.pot = 0;
            newState.message = winResult.message ?? 'Showdown! Pot split.';
        }

        return newState;
    },

    getLegalActions: (state: TexasHoldemState, playerId: string): TexasHoldemAction[] => {
        if (state.status !== 'PLAYING') return [];
        if (!state.activePlayers || !state.activePlayers.includes(playerId)) return [];

        const actions: TexasHoldemAction[] = [];
        const baseActions: TexasHoldemAction[] = [
            { type: 'FOLD', playerId },
            { type: 'CHECK', playerId },
            { type: 'CALL', playerId }
        ];

        for (const action of baseActions) {
            if (TexasHoldemRuleset.isValidAction(state, action)) {
                actions.push(action);
            }
        }

        // RAISEオプション（AI等が選べるように代表的な額をいくつか提示）
        const playerChips = state.playerChips[playerId];
        const amounts = [10, 50, 100, playerChips]; // 簡易的な選択肢
        for (const amt of amounts) {
            const raiseAction: TexasHoldemAction = { type: 'RAISE', amount: amt, playerId };
            if (TexasHoldemRuleset.isValidAction(state, raiseAction)) {
                // 重複排除（同じアクション）
                if (!actions.some(a => a.type === 'RAISE' && a.amount === amt)) {
                    actions.push(raiseAction);
                }
            }
        }

        return actions;
    }
};
