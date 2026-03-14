// packages/shared/rules/HanafudaRuleset.ts
import type { BaseGameState, BaseGameAction, GameRuleset } from '../UniversalEngine';

// --- 1. 型定義 ---

export type Card = string; // 例: "1a", "12d1"

export interface HanafudaState extends BaseGameState {
    playerIds: string[]; // [親のID, 子のID]
    turnIndex: number;   // 0 or 1

    deck: Card[];
    field: Card[];
    hands: Record<string, Card[]>;
    captured: Record<string, Card[]>;

    phase:
    | 'PLAY_HAND'
    | 'CHOOSE_HAND_MATCH'
    | 'DRAW_DECK'
    | 'CHOOSE_DECK_MATCH'
    | 'KOIKOI_OR_STOP';

    pendingCard?: Card;
    matchingOptions?: Card[];

    yakuScores: Record<string, number>;
    koikoiCount: Record<string, number>;
}

export type HanafudaActionType = 'PLAY_CARD' | 'CHOOSE_MATCH' | 'DRAW_DECK' | 'CALL_KOIKOI' | 'STOP';

export interface HanafudaAction extends BaseGameAction {
    type: HanafudaActionType;
    card?: Card;
}

// --- 2. 内部ヘルパー ---

const getMonth = (card: Card): number => parseInt(card.replace(/[a-d]/g, ''), 10);

const createDeck = (): Card[] => {
    const deck: Card[] = [];
    const distributions: Record<number, string[]> = {
        1: ['a', 'c', 'd', 'd'], 2: ['b', 'c', 'd', 'd'], 3: ['a', 'c', 'd', 'd'],
        4: ['b', 'c', 'd', 'd'], 5: ['b', 'c', 'd', 'd'], 6: ['b', 'c', 'd', 'd'],
        7: ['b', 'c', 'd', 'd'], 8: ['a', 'b', 'd', 'd'], 9: ['b', 'c', 'd', 'd'],
        10: ['b', 'c', 'd', 'd'], 11: ['a', 'b', 'c', 'd'], 12: ['a', 'd', 'd', 'd'],
    };
    for (const [month, types] of Object.entries(distributions)) {
        let dCount = 1;
        types.forEach(type => {
            if (type === 'd') {
                deck.push(`${month}d${dCount++}`);
            } else {
                deck.push(`${month}${type}`);
            }
        });
    }
    return deck.sort(() => Math.random() - 0.5);
};

// 【外部委譲用】役判定モック
const calculateYakuMock = (capturedCards: Card[]): { score: number, yakuNames: string[] } => {
    let score = 0;
    const yakuNames: string[] = [];
    const kasuCount = capturedCards.filter(c => c.includes('d')).length;
    if (kasuCount >= 10) {
        score += 1 + (kasuCount - 10);
        yakuNames.push(`カス(${kasuCount}枚)`);
    }
    return { score, yakuNames };
};

// ターン交代 or 役チェックの進行処理
const proceedToNextTurnOrYakuCheck = (state: HanafudaState, playerId: string): HanafudaState => {
    const yakuResult = calculateYakuMock(state.captured[playerId]);

    // 役が増えた場合はこいこい判定へ
    if (yakuResult.score > state.yakuScores[playerId]) {
        state.yakuScores[playerId] = yakuResult.score;
        state.phase = 'KOIKOI_OR_STOP';
        return state;
    }

    // 両者の手札が尽きたら流局
    if (state.hands[state.playerIds[0]].length === 0 && state.hands[state.playerIds[1]].length === 0) {
        state.status = 'FINISHED';
        state.message = "手札が尽きました。流局です。";
        state.activePlayers = [];
        return state;
    }

    // ターンを交代
    state.turnIndex = 1 - state.turnIndex;
    state.phase = 'PLAY_HAND';
    state.pendingCard = undefined;
    state.matchingOptions = undefined;

    // BaseGameStateの規約に沿ってアクティブプレイヤーを更新
    state.activePlayers = [state.playerIds[state.turnIndex]];
    return state;
};

// --- 3. ルールセット本体 ---

export const HanafudaRuleset: GameRuleset<HanafudaState, HanafudaAction> = {
    getInitialState: (options: { playerIds: string[] }): HanafudaState => {
        // [TODO] 実運用時はoptions.playerIdsが存在するかチェックする
        const playerIds = options?.playerIds || ['player1', 'player2'];
        const deck = createDeck();
        const hands: Record<string, Card[]> = { [playerIds[0]]: [], [playerIds[1]]: [] };
        const captured: Record<string, Card[]> = { [playerIds[0]]: [], [playerIds[1]]: [] };
        const field: Card[] = [];

        for (let i = 0; i < 8; i++) {
            hands[playerIds[0]].push(deck.pop()!);
            hands[playerIds[1]].push(deck.pop()!);
            field.push(deck.pop()!);
        }

        return {
            status: 'WAITING',
            players: { [playerIds[0]]: playerIds[0], [playerIds[1]]: playerIds[1] },
            activePlayers: [playerIds[0]], // 最初は親の番
            playerIds,
            turnIndex: 0,
            deck,
            field,
            hands,
            captured,
            phase: 'PLAY_HAND',
            yakuScores: { [playerIds[0]]: 0, [playerIds[1]]: 0 },
            koikoiCount: { [playerIds[0]]: 0, [playerIds[1]]: 0 },
        };
    },

    isValidAction: (state, action) => {
        if (state.status !== 'PLAYING') return false;

        // エンジン側で検証済みの playerId を使用
        const pId = action.playerId;
        if (!pId || !state.activePlayers?.includes(pId)) return false;

        // getLegalActions で生成されるリストに存在するかどうかで判定（ロジックの共通化）
        const legalActions = HanafudaRuleset.getLegalActions(state, pId);

        return legalActions.some(legalAction => {
            if (legalAction.type !== action.type) return false;
            if (action.card && legalAction.card !== action.card) return false;
            return true;
        });
    },

    getLegalActions: (state, playerId) => {
        if (state.status !== 'PLAYING') return [];
        if (!state.activePlayers?.includes(playerId)) return [];

        const actions: HanafudaAction[] = [];

        switch (state.phase) {
            case 'PLAY_HAND':
                state.hands[playerId].forEach(card => {
                    actions.push({ type: 'PLAY_CARD', card, playerId });
                });
                break;
            case 'CHOOSE_HAND_MATCH':
            case 'CHOOSE_DECK_MATCH':
                state.matchingOptions?.forEach(card => {
                    actions.push({ type: 'CHOOSE_MATCH', card, playerId });
                });
                break;
            case 'DRAW_DECK':
                actions.push({ type: 'DRAW_DECK', playerId });
                break;
            case 'KOIKOI_OR_STOP':
                actions.push({ type: 'CALL_KOIKOI', playerId });
                actions.push({ type: 'STOP', playerId });
                break;
        }

        return actions;
    },

    reduce: (state, action) => {
        const newState = structuredClone(state);
        const pId = action.playerId!;

        // 変更点: newState.phase を直接書き換えるのではなく、次のフェーズを return するように変更
        const handleCardMatch = (
            playedCard: Card,
            nextPhaseZeroOrOne: HanafudaState['phase'],
            nextPhaseTwo: HanafudaState['phase']
        ): HanafudaState['phase'] => {
            const month = getMonth(playedCard);
            const matches = newState.field.filter(c => getMonth(c) === month);

            if (matches.length === 0) {
                newState.field.push(playedCard);
                return nextPhaseZeroOrOne;
            } else if (matches.length === 1 || matches.length === 3) {
                newState.captured[pId].push(playedCard, ...matches);
                newState.field = newState.field.filter(c => !matches.includes(c));
                return nextPhaseZeroOrOne;
            } else if (matches.length === 2) {
                newState.pendingCard = playedCard;
                newState.matchingOptions = matches;
                return nextPhaseTwo;
            }
            return newState.phase; // fallback
        };

        switch (newState.phase) {
            case 'PLAY_HAND':
                newState.hands[pId] = newState.hands[pId].filter(c => c !== action.card);
                // 変更点: 戻り値を受け取って明示的に代入する
                newState.phase = handleCardMatch(action.card!, 'DRAW_DECK', 'CHOOSE_HAND_MATCH');
                break;

            case 'CHOOSE_HAND_MATCH':
                newState.captured[pId].push(newState.pendingCard!, action.card!);
                newState.field = newState.field.filter(c => c !== action.card);
                newState.pendingCard = undefined;
                newState.matchingOptions = undefined;
                newState.phase = 'DRAW_DECK';
                break;

            case 'DRAW_DECK':
                if (newState.deck.length === 0) {
                    return proceedToNextTurnOrYakuCheck(newState, pId);
                }
                const drawnCard = newState.deck.pop()!;
                // 変更点: 戻り値を受け取って明示的に代入する
                newState.phase = handleCardMatch(drawnCard, 'PLAY_HAND', 'CHOOSE_DECK_MATCH');

                // ここで比較しても、直前で代入されているので TypeScript はエラーを出さない！
                if (newState.phase === 'PLAY_HAND') {
                    return proceedToNextTurnOrYakuCheck(newState, pId);
                }
                break;

            case 'CHOOSE_DECK_MATCH':
                newState.captured[pId].push(newState.pendingCard!, action.card!);
                newState.field = newState.field.filter(c => c !== action.card);
                newState.pendingCard = undefined;
                newState.matchingOptions = undefined;
                return proceedToNextTurnOrYakuCheck(newState, pId);

            case 'KOIKOI_OR_STOP':
                if (action.type === 'STOP') {
                    newState.status = 'FINISHED';
                    const score = newState.yakuScores[pId];
                    newState.message = `プレイヤー ${pId} の勝ち（${score}文）`;
                    newState.activePlayers = [];
                } else if (action.type === 'CALL_KOIKOI') {
                    newState.koikoiCount[pId]++;
                    newState.turnIndex = 1 - newState.turnIndex;
                    newState.phase = 'PLAY_HAND';
                    newState.activePlayers = [newState.playerIds[newState.turnIndex]];
                }
                break;
        }

        return newState;
    },

    checkWinCondition: (state) => {
        if (state.status === 'FINISHED') {
            return { isFinished: true, message: state.message };
        }
        return { isFinished: false };
    },

    // 相手の情報を隠蔽する
    maskState: (state, playerId) => {
        const maskedState = structuredClone(state);
        // 山札を隠す
        maskedState.deck = maskedState.deck.map(() => '?');
        // 自分以外の手札を隠す
        for (const pId of Object.keys(maskedState.hands)) {
            if (pId !== playerId) {
                maskedState.hands[pId] = maskedState.hands[pId].map(() => '?');
            }
        }
        return maskedState;
    }
};