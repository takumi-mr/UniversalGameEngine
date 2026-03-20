// packages/shared/rules/DaifugoRuleset.ts
import type { BaseGameState, BaseGameAction, GameRuleset } from '../GameRules';

export type Card = string;

export interface DaifugoState extends BaseGameState {
    playerIds: string[];         // 参加プレイヤー（通常4人など）
    hands: Record<string, Card[]>; // 各プレイヤーの手札

    // トリック（場）の状態
    tableCards: Card[];          // 現在場に出ているカード
    lastPlayedPlayerId: string | null; // 最後にカードを出したプレイヤー（場を流す判定に使用）
    passedPlayers: string[];     // 現在のトリックでパスしたプレイヤー

    // 進行状態
    turnIndex: number;           // 現在の手番のインデックス
    ranks: string[];             // あがったプレイヤーのリスト（1位、2位...の順）
}

export interface DaifugoAction extends BaseGameAction {
    type: 'PLAY' | 'PASS';
    cards?: Card[];              // PLAYの場合に出すカードの配列
}

// --- ヘルパー関数群 ---

// カードの強さを数値化 (3=3, ..., 10=10, J=11, Q=12, K=13, A=14, 2=15, JR=16)
function getCardStrength(card: Card): number {
    if (card === 'JR') return 16;
    const rank = card.charAt(0);
    if (rank === 'A') return 14;
    if (rank === 'K') return 13;
    if (rank === 'Q') return 12;
    if (rank === 'J') return 11;
    if (rank === 'T') return 10;
    if (rank === '2') return 15;
    return parseInt(rank, 10);
}

// 出されたカードのセットを評価し、強さを返す（不正な出し方なら null）
function evaluatePlay(cards: Card[]): { size: number, strength: number } | null {
    if (cards.length === 0) return null;

    const strengths = cards.map(getCardStrength).sort((a, b) => a - b);

    // 1枚出し
    if (cards.length === 1) {
        return { size: 1, strength: strengths[0] };
    }

    // 複数枚出し（ペア、スリーカード等）。ローカルルールなしなので、階段（シークエンス）は非対応とする。
    // ジョーカーをワイルドカードとして扱う判定
    const nonJokers = strengths.filter(s => s !== 16);
    const jokersCount = strengths.length - nonJokers.length;

    // ジョーカー以外がすべて同じランク（強さ）であれば有効
    const isSameRank = nonJokers.every(s => s === nonJokers[0]);
    if (!isSameRank && nonJokers.length > 0) return null;

    // 強さは、ジョーカー以外のカードの強さとする（全てジョーカーなら16）
    const strength = nonJokers.length > 0 ? nonJokers[0] : 16;

    return { size: cards.length, strength };
}

// 54枚のデッキを作成してシャッフル
function createDeck(): Card[] {
    const suits = ['S', 'H', 'D', 'C'];
    const ranks = ['3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A', '2'];
    const deck: Card[] = ['JR', 'JR']; // ジョーカー2枚
    for (const s of suits) {
        for (const r of ranks) {
            deck.push(`${r}${s}`);
        }
    }
    return deck.sort(() => Math.random() - 0.5);
}

// --- ルールセット本体 ---

export const DaifugoRuleset: GameRuleset<DaifugoState, DaifugoAction> = {
    getInitialState: (options: any): DaifugoState => {
        const opts = options || {};
        const playerIds = (opts.playerIds || []).filter((id: any) => !!id);
        const deck = createDeck();
        const hands: Record<string, Card[]> = {};

        // 手札を均等に配る
        if (playerIds.length > 0) {
            playerIds.forEach((pId: string) => (hands[pId] = []));

            let i = 0;
            while (deck.length > 0) {
                const targetPlayerId = playerIds[i % playerIds.length];
                if (hands[targetPlayerId]) {
                    hands[targetPlayerId].push(deck.pop()!);
                }
                i++;
            }

            // 手札を強さ順にソート（UX向上）
            Object.keys(hands).forEach(pId => {
                hands[pId].sort((a, b) => getCardStrength(a) - getCardStrength(b));
            });
        }

        return {
            status: 'WAITING',
            players: playerIds.length > 0
                ? playerIds.reduce((acc: Record<string, string>, p: string) => ({ ...acc, [p]: p }), {})
                : { 1: null, 2: null, 3: null, 4: null },
            activePlayers: playerIds.length > 0 ? [playerIds[0]] : [],
            playerIds,
            hands,
            tableCards: [],
            lastPlayedPlayerId: null,
            passedPlayers: [],
            turnIndex: 0,
            ranks: []
        };
    },

    isValidAction: (state, action) => {
        if (state.status !== 'PLAYING') return false;
        const pId = action.playerId!;

        // 自分のターンか？
        if (!state.activePlayers?.includes(pId)) return false;

        if (action.type === 'PASS') return true;

        if (action.type === 'PLAY') {
            const playCards = action.cards || [];

            // そもそも手札にそのカードを持っているか？
            const hand = state.hands[pId];
            for (const c of playCards) {
                if (!hand.includes(c)) return false;
            }

            const playEvaluation = evaluatePlay(playCards);
            if (!playEvaluation) return false;

            // 場にカードがない（親）場合は、有効な組み合わせなら何でも出せる
            if (state.tableCards.length === 0) return true;

            // 場にカードがある場合は、枚数が同じで、かつ「より強い」必要がある
            const tableEvaluation = evaluatePlay(state.tableCards)!;
            if (playEvaluation.size !== tableEvaluation.size) return false;
            if (playEvaluation.strength <= tableEvaluation.strength) return false;

            return true;
        }

        return false;
    },

    reduce: (state, action) => {
        const newState = structuredClone(state); // イミュータブルな更新
        const pId = action.playerId!;

        if (action.type === 'PLAY') {
            const playCards = action.cards!;

            // 手札からカードを削除
            newState.hands[pId] = newState.hands[pId].filter(c => !playCards.includes(c));

            // 場を更新
            newState.tableCards = playCards;
            newState.lastPlayedPlayerId = pId;

            // 誰かがカードを出したら、パス履歴はリセットされる（ローカルルールによっては維持する場合もあるが、今回はリセット）
            newState.passedPlayers = [];

            // あがり判定
            if (newState.hands[pId].length === 0) {
                newState.ranks.push(pId);
            }
        } else if (action.type === 'PASS') {
            newState.passedPlayers.push(pId);
        }

        // --- 次のターンの決定ロジック ---
        let nextIndex = newState.turnIndex;
        let nextPlayerId = "";
        let isTrickCleared = false;

        // 次にカードを出せるプレイヤーを探す
        while (true) {
            nextIndex = (nextIndex + 1) % newState.playerIds.length;
            nextPlayerId = newState.playerIds[nextIndex];

            // すでにあがったプレイヤーはスキップ
            if (newState.ranks.includes(nextPlayerId)) continue;

            // 全員がパス（またはあがり）して、最後にカードを出した人にターンが戻ってきたら「場が流れる（クリア）」
            if (nextPlayerId === newState.lastPlayedPlayerId) {
                isTrickCleared = true;
                break;
            }

            // 最後にカードを出した人が「あがって」いて、他の全員がパスした場合、
            // 「あがった人の次の人」が親になる
            const activeRemaining = newState.playerIds.filter(id => !newState.ranks.includes(id));
            if (newState.passedPlayers.length === activeRemaining.length) {
                isTrickCleared = true;
                break;
            }

            // まだパスしていないプレイヤーがいれば、その人が次の手番
            if (!newState.passedPlayers.includes(nextPlayerId)) {
                break;
            }
        }

        // 場が流れた場合の処理
        if (isTrickCleared) {
            newState.tableCards = [];
            newState.lastPlayedPlayerId = null;
            newState.passedPlayers = [];

            // もし流れた原因（最後にカードを出した人）がすでにあがっていた場合、
            // 次の生き残っているプレイヤーを親（次の手番）とする
            if (newState.ranks.includes(nextPlayerId)) {
                while (newState.ranks.includes(newState.playerIds[nextIndex])) {
                    nextIndex = (nextIndex + 1) % newState.playerIds.length;
                }
            }
        }

        newState.turnIndex = nextIndex;
        newState.activePlayers = [newState.playerIds[newState.turnIndex]];

        return newState;
    },

    checkWinCondition: (state) => {
        // 全員あがって、残り1人になったらゲーム終了
        const remainingPlayers = state.playerIds.filter(id => !state.ranks.includes(id));

        if (remainingPlayers.length <= 1) {
            // 最後に残った人を最下位としてランクに追加
            const finalRanks = [...state.ranks];
            if (remainingPlayers.length === 1) {
                finalRanks.push(remainingPlayers[0]);
            }
            const winnerId = finalRanks[0];
            return {
                isFinished: true,
                winnerIds: winnerId ? [winnerId] : [],
                message: `Game Finished! Winner: ${finalRanks[0]}, Loser: ${finalRanks[finalRanks.length - 1]}`
            };
        }
        return { isFinished: false };
    },

    applyWinResult: (state, winResult) => {
        const newState = structuredClone(state);
        newState.status = 'FINISHED';
        newState.activePlayers = [];

        // 役名を付与（例: 大富豪, 富豪, 平民, 貧民, 大貧民）
        const roleNames: Record<number, string> = {
            0: '大富豪',
            1: '富豪',
        };
        const n = newState.playerIds.length;
        roleNames[n - 1] = '大貧民';
        if (n >= 3) roleNames[n - 2] = '貧民';

        const roleLines = newState.ranks.map((pid, i) => {
            const role = roleNames[i] ?? '平民';
            return `${i + 1}位 [${role}]: ${pid}`;
        });
        newState.message = `ゲーム終了！\n${roleLines.join('\n')}`;

        return newState;
    },

    // 隠匿情報（相手の手札）のマスク処理
    maskState: (state, targetPlayerId) => {
        const maskedState = structuredClone(state);

        for (const pId of Object.keys(maskedState.hands)) {
            if (pId !== targetPlayerId) {
                // 他人の手札は、枚数だけわかるように '?' で埋める
                maskedState.hands[pId] = maskedState.hands[pId].map(() => '?');
            }
        }
        return maskedState;
    },

    getLegalActions: (state: DaifugoState, playerId: string): DaifugoAction[] => {
        if (state.status !== 'PLAYING') return [];
        if (!state.activePlayers || !state.activePlayers.includes(playerId)) return [];

        const actions: DaifugoAction[] = [];

        // パスは常に合法
        const passAction: DaifugoAction = { type: 'PASS', playerId };
        if (DaifugoRuleset.isValidAction(state, passAction)) actions.push(passAction);

        const hand = state.hands[playerId];
        if (!hand) return actions;

        // 手牌をランクごとにグループ化して、同じ数のペアを生成（同じスート構成まで網羅すると膨大になるため簡易組み合わせ）
        const rankGroups: Record<string, Card[]> = {};
        const jokers: Card[] = [];
        for (const card of hand) {
            if (card === 'JR') jokers.push(card);
            else {
                const r = card.charAt(0);
                if (!rankGroups[r]) rankGroups[r] = [];
                rankGroups[r].push(card);
            }
        }

        const testCombos: Card[][] = [];
        for (const group of Object.values(rankGroups)) {
            // ローカルルールを考慮せず、1~最大枚数までの部分配列をそのまま出す（マーク違いは基本的に強さに影響しない）
            for (let i = 1; i <= group.length; i++) {
                testCombos.push(group.slice(0, i));
            }
        }
        for (let i = 1; i <= jokers.length; i++) {
            testCombos.push(jokers.slice(0, i));
        }

        for (const combo of testCombos) {
            const action: DaifugoAction = { type: 'PLAY', cards: combo, playerId };
            if (DaifugoRuleset.isValidAction(state, action)) {
                actions.push(action);
            }
        }

        return actions;
    }
};