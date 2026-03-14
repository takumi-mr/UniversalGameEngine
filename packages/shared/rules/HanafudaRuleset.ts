// packages/shared/rules/HanafudaRuleset.ts
import type { BaseGameState, BaseGameAction, GameRuleset } from '../UniversalEngine';

// 札の表現: {月(1~12)}{種類(a,b,c,d)}
// a: 光/20点札, b: タネ/10点札, c: 短冊/5点札, d: カス/1点札 (月によって存在しない種類もある)
export type Card = string;

export interface HanafudaState extends BaseGameState {
    playerIds: string[];
    turnIndex: number;

    // 物理的な札の場所
    deck: Card[];
    field: Card[];
    hands: Record<string, Card[]>;
    captured: Record<string, Card[]>;

    // ターンの進行状態（ステートマシン）
    phase:
    | 'PLAY_HAND'       // 手札から札を出すフェーズ
    | 'CHOOSE_HAND_MATCH'// 手札から出した札に対する2枚同月の選択フェーズ
    | 'DRAW_DECK'       // 山札からめくるフェーズ
    | 'CHOOSE_DECK_MATCH'// 山札からめくった札に対する2枚同月の選択フェーズ
    | 'KOIKOI_OR_STOP'; // こいこい/勝負の選択フェーズ

    // 進行中の一時データ
    pendingCard?: Card;        // 現在処理中（出した、またはめくった）の札
    matchingOptions?: Card[];  // ユーザーが選べる札の選択肢

    // 役のスコア管理（スコアが上がった時だけKOIKOI_OR_STOPをトリガーするため）
    yakuScores: Record<string, number>;
    koikoiCount: Record<string, number>;
}

export type HanafudaActionType = 'PLAY_CARD' | 'CHOOSE_MATCH' | 'DRAW_DECK' | 'CALL_KOIKOI' | 'STOP';

export interface HanafudaAction extends BaseGameAction {
    type: HanafudaActionType;
    card?: Card;
}

// --- ヘルパー関数 ---

// カードから「月」を取得 (例: "12a" -> 12)
const getMonth = (card: Card): number => parseInt(card.replace(/[a-d]/g, ''), 10);

// 48枚のデッキを生成してシャッフル
const createDeck = (): Card[] => {
    const deck: Card[] = [];
    const distributions: Record<number, string[]> = {
        1: ['a', 'c', 'd', 'd'], // 松: 光, 赤短, カス, カス
        2: ['b', 'c', 'd', 'd'], // 梅: タネ(ウグイス), 赤短, カス, カス
        3: ['a', 'c', 'd', 'd'], // 桜: 光, 赤短, カス, カス
        4: ['b', 'c', 'd', 'd'], // 藤: タネ(ホトトギス), 短, カス, カス
        5: ['b', 'c', 'd', 'd'], // 菖蒲: タネ(八ツ橋), 短, カス, カス
        6: ['b', 'c', 'd', 'd'], // 牡丹: タネ(蝶), 青短, カス, カス
        7: ['b', 'c', 'd', 'd'], // 萩: タネ(猪), 短, カス, カス
        8: ['a', 'b', 'd', 'd'], // 芒: 光, タネ(雁), カス, カス
        9: ['b', 'c', 'd', 'd'], // 菊: タネ(盃), 青短, カス, カス
        10: ['b', 'c', 'd', 'd'], // 紅葉: タネ(鹿), 青短, カス, カス
        11: ['a', 'b', 'c', 'd'], // 柳: 光(小野道風), タネ(燕), 短, カス(鬼札)
        12: ['a', 'd', 'd', 'd'], // 桐: 光, カス, カス, カス
    };
    for (const [month, types] of Object.entries(distributions)) {
        // カス札の重複を防ぐため、d1, d2 のように連番を振る
        let dCount = 1;
        types.forEach(type => {
            if (type === 'd') {
                deck.push(`${month}d${dCount}`);
                dCount++;
            } else {
                deck.push(`${month}${type}`);
            }
        });
    }
    return deck.sort(() => Math.random() - 0.5);
};

// 【外部委譲用】役判定関数 (モック)
// 実際には外部ライブラリに `capturedCards` を渡して計算結果を受け取ります。
const calculateYakuMock = (capturedCards: Card[]): { score: number, yakuNames: string[] } => {
    let score = 0;
    const yakuNames: string[] = [];

    // 簡易的なカス10枚判定のモック
    const kasuCount = capturedCards.filter(c => c.includes('d')).length;
    if (kasuCount >= 10) {
        score += 1 + (kasuCount - 10);
        yakuNames.push(`カス(${kasuCount}枚)`);
    }
    // 実際にはここに五光や猪鹿蝶などの判定が入る
    return { score, yakuNames };
};

// 次のフェーズへの遷移を処理する内部ヘルパー
const proceedToNextTurnOrYakuCheck = (state: HanafudaState, playerId: string): HanafudaState => {
    const yakuResult = calculateYakuMock(state.captured[playerId]);

    // スコアが前回より増えていたら、こいこい/勝負の選択へ
    if (yakuResult.score > state.yakuScores[playerId]) {
        state.yakuScores[playerId] = yakuResult.score;
        state.phase = 'KOIKOI_OR_STOP';
        return state;
    }

    // 両者の手札が尽きたらゲーム終了（引き分け、または親権等のルール依存）
    if (state.hands[state.playerIds[0]].length === 0 && state.hands[state.playerIds[1]].length === 0) {
        state.status = 'FINISHED';
        state.message = "手札が尽きました。流局（引き分け）です。";
        return state;
    }

    // 次のターンの人の 'PLAY_HAND' フェーズへ移行
    state.turnIndex = 1 - state.turnIndex;
    state.phase = 'PLAY_HAND';
    state.pendingCard = undefined;
    state.matchingOptions = undefined;

    if (state.players) {
        state.activePlayers = [state.playerIds[state.turnIndex]];
    }
    return state;
};

// --- ルールセット本体 ---

export const HanafudaRuleset: GameRuleset<HanafudaState, HanafudaAction> = {
    getInitialState: (options: { playerIds: string[] }): HanafudaState => {
        const playerIds = options.playerIds;
        const deck = createDeck();
        const hands: Record<string, Card[]> = { [playerIds[0]]: [], [playerIds[1]]: [] };
        const captured: Record<string, Card[]> = { [playerIds[0]]: [], [playerIds[1]]: [] };
        const field: Card[] = [];

        // 手札8枚、場8枚を配る
        for (let i = 0; i < 8; i++) {
            hands[playerIds[0]].push(deck.pop()!);
            hands[playerIds[1]].push(deck.pop()!);
            field.push(deck.pop()!);
        }

        return {
            status: 'PLAYING',
            playerIds,
            turnIndex: 0,
            players: { [playerIds[0]]: playerIds[0], [playerIds[1]]: playerIds[1] },
            activePlayers: [playerIds[0]],
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
        const currentPlayerId = state.playerIds[state.turnIndex];
        if (action.playerId !== currentPlayerId) return false;

        switch (state.phase) {
            case 'PLAY_HAND':
                return action.type === 'PLAY_CARD' && !!action.card && state.hands[currentPlayerId].includes(action.card);
            case 'CHOOSE_HAND_MATCH':
            case 'CHOOSE_DECK_MATCH':
                return action.type === 'CHOOSE_MATCH' && !!action.card && state.matchingOptions!.includes(action.card);
            case 'DRAW_DECK':
                return action.type === 'DRAW_DECK';
            case 'KOIKOI_OR_STOP':
                return action.type === 'CALL_KOIKOI' || action.type === 'STOP';
            default:
                return false;
        }
    },

    reduce: (state, action) => {
        const newState = structuredClone(state);
        const pId = action.playerId!;

        const handleCardMatch = (playedCard: Card, nextPhaseZeroOrOne: HanafudaState['phase'], nextPhaseTwo: HanafudaState['phase']) => {
            const month = getMonth(playedCard);
            const matches = newState.field.filter(c => getMonth(c) === month);

            if (matches.length === 0) {
                // 一致なし：場に残す
                newState.field.push(playedCard);
                newState.phase = nextPhaseZeroOrOne;
            } else if (matches.length === 1 || matches.length === 3) {
                // 1枚、または3枚：すべて獲得
                newState.captured[pId].push(playedCard, ...matches);
                newState.field = newState.field.filter(c => !matches.includes(c));
                newState.phase = nextPhaseZeroOrOne;
            } else if (matches.length === 2) {
                // 2枚：選択フェーズへ
                newState.pendingCard = playedCard;
                newState.matchingOptions = matches;
                newState.phase = nextPhaseTwo;
            }
        };

        switch (newState.phase) {
            case 'PLAY_HAND':
                if (action.type === 'PLAY_CARD') {
                    // 手札から出す
                    newState.hands[pId] = newState.hands[pId].filter(c => c !== action.card);
                    handleCardMatch(action.card!, 'DRAW_DECK', 'CHOOSE_HAND_MATCH');
                }
                break;

            case 'CHOOSE_HAND_MATCH':
                if (action.type === 'CHOOSE_MATCH') {
                    // 選択した札と出した札を獲得し、山札フェーズへ
                    newState.captured[pId].push(newState.pendingCard!, action.card!);
                    newState.field = newState.field.filter(c => c !== action.card);
                    newState.pendingCard = undefined;
                    newState.matchingOptions = undefined;
                    newState.phase = 'DRAW_DECK';
                }
                break;

            case 'DRAW_DECK':
                if (action.type === 'DRAW_DECK') {
                    if (newState.deck.length === 0) {
                        return proceedToNextTurnOrYakuCheck(newState, pId);
                    }
                    const drawnCard = newState.deck.pop()!;
                    // 山札からめくった後の挙動（一致なし/1・3枚なら役判定へ。2枚なら選択フェーズへ）
                    handleCardMatch(drawnCard, 'PLAY_HAND', 'CHOOSE_DECK_MATCH');

                    // PLAY_HAND になったということは、選択不要で終わったので、役チェックに進む
                    if (newState.phase === 'PLAY_HAND') {
                        return proceedToNextTurnOrYakuCheck(newState, pId);
                    }
                }
                break;

            case 'CHOOSE_DECK_MATCH':
                if (action.type === 'CHOOSE_MATCH') {
                    // 選択した札と、めくった札を獲得し、役チェックへ
                    newState.captured[pId].push(newState.pendingCard!, action.card!);
                    newState.field = newState.field.filter(c => c !== action.card);
                    newState.pendingCard = undefined;
                    newState.matchingOptions = undefined;
                    return proceedToNextTurnOrYakuCheck(newState, pId);
                }
                break;

            case 'KOIKOI_OR_STOP':
                if (action.type === 'STOP') {
                    newState.status = 'FINISHED';
                    const score = newState.yakuScores[pId];
                    newState.message = `勝負！ プレイヤー ${pId} の勝ち（${score}文）`;
                } else if (action.type === 'CALL_KOIKOI') {
                    newState.koikoiCount[pId]++;
                    // こいこい継続なので次の人のターンへ
                    newState.turnIndex = 1 - newState.turnIndex;
                    newState.phase = 'PLAY_HAND';
                    if (newState.players) {
                        newState.activePlayers = [newState.playerIds[newState.turnIndex]];
                    }
                }
                break;
        }

        return newState;
    },

    checkWinCondition: (state) => {
        if (state.status === 'FINISHED') {
            return { isFinished: true, message: state.message || 'Game Finished' };
        }
        return { isFinished: false };
    },

    maskState: (state, targetPlayerId) => {
        const maskedState = structuredClone(state);
        // 相手の手札と山札を隠蔽する
        for (const pId of Object.keys(maskedState.hands)) {
            if (pId !== targetPlayerId) {
                maskedState.hands[pId] = maskedState.hands[pId].map(() => '?');
            }
        }
        maskedState.deck = maskedState.deck.map(() => '?');
        return maskedState;
    }
};