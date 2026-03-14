// EquilibriumRuleset.ts

/**
 *      ______            _ _ _ _          _                     _______ _            _               _      _____             _ 
 *     |  ____|          (_) (_) |        (_)                _  |__   __| |          | |             | |    / ____|           | |
 *     | |__   __ _ _   _ _| |_| |__  _ __ _ _   _ _ __ ___ (_)    | |  | |__   ___  | |     __ _ ___| |_  | (___   ___  _   _| |
 *     |  __| / _` | | | | | | | '_ \| '__| | | | | '_ ` _ \       | |  | '_ \ / _ \ | |    / _` / __| __|  \___ \ / _ \| | | | |
 *     | |___| (_| | |_| | | | | |_) | |  | | |_| | | | | | |_     | |  | | | |  __/ | |___| (_| \__ \ |_   ____) | (_) | |_| | |
 *     |______\__, |\__,_|_|_|_|_.__/|_|  |_|\__,_|_| |_| |_(_)    |_|  |_| |_|\___| |______\__,_|___/\__| |_____/ \___/ \__,_|_|
 *               | |                                                                                                             
 *               |_|                                                                                                             
 * 
 * The World's Most Interesting Game, According to AI
 */

import { BaseGameState, BaseGameAction, GameRuleset } from '../UniversalEngine';

// ==========================================
// 1. 型定義 (Types & Interfaces)
// ==========================================

export type CardType = 'ATTACK' | 'DEFENSE' | 'TRICK' | 'GOAL';

export interface Card {
    id: string;
    type: CardType;
    name: string;
    value: number; // 攻撃力や防御力、あるいは目標達成のためのポイント
    cost: number;  // 使用または入札に必要なSoul Point
}

// ゲーム固有の状態
export interface EquilibriumState extends BaseGameState {
    turnCount: number;
    phase: 'AUCTION' | 'MAIN';
    auctionPool: Card[];
    currentBids: Record<string, number>;
    passedPlayers: string[];

    playerData: Record<string, PlayerState>;
}

export interface PlayerState {
    id: string;
    hp: number;
    soulPoints: number; // これが通貨であり、命を削るリソース
    hand: Card[];
    board: Card[];      // 場に出して永続効果を発揮しているカード
    hiddenGoal: Card | null;   // 現在の秘密の勝利条件
    fakeReveal?: Card;  // 相手を騙すために意図的に見せている「嘘のカード」
}

// ゲーム固有のアクション
export type EquilibriumAction =
    | { type: 'BID'; playerId: string; amount: number; timestamp?: number }
    | { type: 'PASS_AUCTION'; playerId: string; timestamp?: number }
    | { type: 'PLAY_CARD'; playerId: string; cardId: string; targetId?: string; timestamp?: number }
    | { type: 'ALTER_GOAL'; playerId: string; newGoalCardId: string; timestamp?: number }
    | { type: 'BLUFF_REVEAL'; playerId: string; fakeCard: Card; timestamp?: number }
    | { type: 'END_TURN'; playerId: string; timestamp?: number };


// ==========================================
// 2. ルールセット本体 (Ruleset Implementation)
// ==========================================

export class EquilibriumRuleset implements GameRuleset<EquilibriumState, EquilibriumAction> {

    // --- 初期化 ---
    public getInitialState(options: { playerIds: string[] }): EquilibriumState {
        const initialPlayerData: Record<string, PlayerState> = {};

        options.playerIds.forEach(id => {
            initialPlayerData[id] = {
                id,
                hp: 20,
                soulPoints: 10, // 初期リソース
                hand: this.drawInitialCards(),
                board: [],
                hiddenGoal: this.drawRandomGoal(), // 各自に秘密の勝利条件を配布
            };
        });

        return {
            status: 'PLAYING',
            players: Object.fromEntries(options.playerIds.map(id => [id, id])), // エンジンの標準形式
            activePlayers: [...options.playerIds], // オークションは全員同時進行
            turnCount: 1,
            phase: 'AUCTION',
            auctionPool: [this.generateRandomCard()], // 場に1枚の強力なカードが出る
            currentBids: {},
            playerData: initialPlayerData,
        } as unknown as EquilibriumState; // ※型の簡略化のためキャスト
    }

    // --- 合法手判定 (バリデーション) ---
    public isValidAction(state: EquilibriumState, action: EquilibriumAction): boolean {
        const player = state.playerData[action.playerId];
        if (!player) return false;
        if (!state.activePlayers?.includes(action.playerId)) return false;

        switch (action.type) {
            case 'BID':
                // フェーズがAUCTIONであり、自分のSoul Pointの範囲内か？
                return state.phase === 'AUCTION' && action.amount <= player.soulPoints;
            case 'PLAY_CARD':
                // フェーズがMAINであり、手札にそのカードがあり、コストが払えるか？
                const card = player.hand.find(c => c.id === action.cardId);
                return state.phase === 'MAIN' && card !== undefined && player.soulPoints >= card.cost;
            case 'ALTER_GOAL':
                return state.phase === 'MAIN' && player.hand.some(c => c.id === action.newGoalCardId && c.type === 'GOAL');
            case 'BLUFF_REVEAL':
                // いつでも嘘の情報をセットできるがコストがかかる
                return player.soulPoints >= 1;
            default:
                return true;
        }
    }

    // --- 状態遷移 (Reducer) ---
    // 副作用を持たせず、新しいStateオブジェクトを生成して返す
    public reduce(state: EquilibriumState, action: EquilibriumAction): EquilibriumState {
        const nextState = JSON.parse(JSON.stringify(state)) as EquilibriumState;
        const player = nextState.playerData[action.playerId];

        switch (action.type) {
            // ... (BID, PLAY_CARD, ALTER_GOAL, BLUFF_REVEAL はこれまでの実装と同様)

            case 'END_TURN':
                // パスしたプレイヤーとして記録
                if (!nextState.passedPlayers.includes(action.playerId)) {
                    nextState.passedPlayers.push(action.playerId);
                }

                const allPlayerIds = Object.keys(nextState.playerData);

                // 全員がターンを終了したか？
                if (nextState.passedPlayers.length >= allPlayerIds.length) {
                    // ★ 新しいターン（オークションフェーズ）の開始
                    nextState.turnCount += 1;
                    nextState.phase = 'AUCTION';
                    nextState.passedPlayers = [];
                    nextState.currentBids = {};
                    nextState.auctionPool = [this.generateRandomCard()]; // 新たな目玉商品を出品
                    nextState.activePlayers = [...allPlayerIds]; // オークションは全員同時参加

                    // ターン経過ボーナス (全プレイヤーにSoul Point回復とドロー)
                    for (const pId of allPlayerIds) {
                        nextState.playerData[pId].soulPoints += 2; // 毎ターンリソースが少し回復
                        nextState.playerData[pId].hand.push(this.drawRandomBasicCard()); // 手札補充
                    }
                } else {
                    // まだ行動していない次のプレイヤーへ手番を渡す
                    nextState.activePlayers = [this.getNextPlayer(nextState, action.playerId)];
                }
                break;
        }

        return nextState;
    }

    // --- 勝敗判定 ---
    public checkWinCondition(state: EquilibriumState): { isFinished: boolean; message?: string } {
        const playerIds = Object.keys(state.playerData);

        // 1. 共通ルール: HPが0になったら脱落（最後まで生き残った者の勝利）
        const alivePlayers = playerIds.filter(id => state.playerData[id].hp > 0);
        if (alivePlayers.length === 1) {
            return { isFinished: true, message: `Player ${alivePlayers[0]} won by Last Man Standing!` };
        } else if (alivePlayers.length === 0) {
            return { isFinished: true, message: `Draw! All players died.` };
        }

        // 2. 各プレイヤーの秘密の勝利条件（hiddenGoal）を評価
        for (const pId of playerIds) {
            const player = state.playerData[pId];
            const goal = player.hiddenGoal;

            if (!goal) continue; // ゴールカードを持っていない場合はスキップ

            switch (goal.name) {
                case 'Annihilator':
                    // 相手のHPを0にする（上の共通ルールでほぼカバーされるが、明示的な目標として）
                    if (alivePlayers.length === 1 && alivePlayers[0] === pId) {
                        return { isFinished: true, message: `Player ${pId} achieved GOAL: Annihilator!` };
                    }
                    break;

                case 'Collector':
                    // 自分の場(Board)にカードを5枚以上並べれば即座に勝利
                    if (player.board.length >= 5) {
                        return { isFinished: true, message: `Player ${pId} achieved GOAL: Collector (5+ cards on board)!` };
                    }
                    break;

                case 'Pacifist':
                    // 誰も死なない平和な状態のまま、10ターン目に到達すれば勝利
                    if (state.turnCount >= 10 && alivePlayers.length === playerIds.length) {
                        return { isFinished: true, message: `Player ${pId} achieved GOAL: Pacifist (Survived 10 turns peacefully)!` };
                    }
                    break;

                case 'Soul_Hoarder':
                    // 競り（オークション）を我慢し、Soul Pointを15以上溜め込めば勝利
                    if (player.soulPoints >= 15) {
                        return { isFinished: true, message: `Player ${pId} achieved GOAL: Soul Hoarder (15+ Soul Points)!` };
                    }
                    break;
            }
        }

        // 誰も条件を満たしていない場合はゲーム続行
        return { isFinished: false };
    }

    // --- ★最重要：隠匿情報の動的マスク (MaskState) ---
    // エンジンがクライアントへ状態を送信する直前に呼ばれる
    public maskState(state: EquilibriumState, requestingPlayerId: string): EquilibriumState {
        const maskedState = JSON.parse(JSON.stringify(state)) as EquilibriumState;

        for (const pId in maskedState.players) {
            if (pId !== requestingPlayerId) {
                const opponent = maskedState.playerData[pId];

                // 1. 相手の手札の内容は見せない（枚数だけにするか、ダミーデータで上書き）
                opponent.hand = opponent.hand.map(c => ({ id: 'hidden', type: 'TRICK', name: 'Unknown', value: 0, cost: 0 }));

                // 2. 相手の勝利条件を隠す
                opponent.hiddenGoal = null;

                // 3. 【ディセプション機能】もし相手が「偽のカード」を仕掛けていたら、それを視界に混ぜる！
                if (opponent.fakeReveal) {
                    // 本当は持っていない偽のカードを、まるで相手の手札や目標であるかのようにクライアントへ送る
                    opponent.hand[0] = opponent.fakeReveal;
                }

                // fakeRevealのメタデータ自体はクライアントに送らない（バレないように削除）
                delete opponent.fakeReveal;
            }
        }
        return maskedState;
    }

    // --- AIサポート ---
    public getLegalActions(state: EquilibriumState, playerId: string): EquilibriumAction[] {
        const actions: EquilibriumAction[] = [];
        const player = state.playerData[playerId];

        if (state.phase === 'AUCTION') {
            actions.push({ type: 'PASS_AUCTION', playerId });
            for (let i = 1; i <= player.soulPoints; i++) {
                actions.push({ type: 'BID', playerId, amount: i });
            }
        } else if (state.phase === 'MAIN') {
            player.hand.forEach(card => {
                if (player.soulPoints >= card.cost) {
                    actions.push({ type: 'PLAY_CARD', playerId, cardId: card.id }); // target等の網羅は省略
                }
            });
        }
        return actions;
    }

    // ==========================================
    // 3. ヘルパーメソッド (内部ロジック)
    // ==========================================

    // --- ターン進行ヘルパーの実装 ---
    // メインフェーズでのターン交代処理
    private getNextPlayer(state: EquilibriumState, currentPlayerId: string): string {
        const playerIds = Object.keys(state.playerData);
        const currentIndex = playerIds.indexOf(currentPlayerId);

        // すでにパス(END_TURN)したプレイヤーをスキップして、次のプレイヤーを探す
        for (let i = 1; i < playerIds.length; i++) {
            const nextIndex = (currentIndex + i) % playerIds.length;
            const nextId = playerIds[nextIndex];
            if (!state.passedPlayers.includes(nextId)) {
                return nextId;
            }
        }
        return currentPlayerId; // フォールバック
    }

    // (参考) 基本カードのドロー用ヘルパー
    private drawRandomBasicCard(): Card {
        const pool = this.drawInitialCards();
        return pool[Math.floor(Math.random() * pool.length)];
    }

    // 一意のIDを生成する簡易関数（本番環境では uuid などを推奨）
    private generateId(): string {
        return Math.random().toString(36).substring(2, 9);
    }
    // --- カード生成系 ---

    // ゲーム開始時に配られる初期手札（弱い基本カード群）
    private drawInitialCards(): Card[] {
        return [
            { id: this.generateId(), type: 'ATTACK', name: 'Strike', value: 2, cost: 1 },
            { id: this.generateId(), type: 'DEFENSE', name: 'Guard', value: 2, cost: 1 },
            { id: this.generateId(), type: 'TRICK', name: 'Peep', value: 0, cost: 2 }, // 相手の情報を探る用
        ];
    }

    // プレイヤーに秘密裏に配られる勝利条件カード
    private drawRandomGoal(): Card {
        const goals: Omit<Card, 'id'>[] = [
            { type: 'GOAL', name: 'Annihilator', value: 0, cost: 0 },  // 相手のHPを0にする（基本）
            { type: 'GOAL', name: 'Collector', value: 5, cost: 0 },    // 自分の場（Board）にカードを5枚以上並べる
            { type: 'GOAL', name: 'Pacifist', value: 10, cost: 0 },    // 10ターン目まで誰も死なずに生き残る
            { type: 'GOAL', name: 'Soul_Hoarder', value: 15, cost: 0 } // Soul Pointを15以上溜め込む
        ];
        // ランダムに1つ選出
        const selected = goals[Math.floor(Math.random() * goals.length)];
        return { ...selected, id: this.generateId() } as Card;
    }

    // オークション（競り）に出品される強力なカード
    private generateRandomCard(): Card {
        const pool: Omit<Card, 'id'>[] = [
            { type: 'ATTACK', name: 'Hellfire', value: 8, cost: 3 },     // 高火力
            { type: 'DEFENSE', name: 'Aegis_Shield', value: 7, cost: 2 },// 高耐久
            { type: 'TRICK', name: 'Mind_Control', value: 0, cost: 4 },  // 強力な妨害
            { type: 'GOAL', name: 'Sudden_Death', value: 0, cost: 0 }    // 新たな勝利条件（すり替え用）
        ];
        const selected = pool[Math.floor(Math.random() * pool.length)];
        return { ...selected, id: this.generateId() } as Card;
    }

    // --- ゲーム進行ロジック ---

    // オークションの入札が出揃った際の解決処理
    private resolveAuction(state: EquilibriumState): void {
        let maxBid = -1;
        let winnerId = '';
        let isTie = false;

        // 1. 最高額の入札者を特定する
        for (const [pId, bid] of Object.entries(state.currentBids)) {
            if (bid > maxBid) {
                maxBid = bid;
                winnerId = pId;
                isTie = false;
            } else if (bid === maxBid) {
                isTie = true; // 同額の場合は引き分け処理（今回は流札とする）
            }
        }

        // 2. 落札処理
        if (!isTie && winnerId !== '') {
            const winner = state.playerData[winnerId];
            // 落札者のSoul Pointを減らし、カードを手札に加える
            winner.soulPoints -= maxBid;
            winner.hand.push(...state.auctionPool);

            // 落札者が次のメインフェーズの最初のアクティブプレイヤーになる
            state.activePlayers = [winnerId];
        } else {
            // 同点（流札）の場合は、ランダムまたはホストプレイヤーから開始するなどの処理
            // 今回は単純化のため、配列の先頭のプレイヤーをアクティブにする
            const allPlayers = Object.keys(state.playerData);
            state.activePlayers = [allPlayers[0]];
        }

        // 3. オークション場のリセットとフェーズ移行
        state.auctionPool = [];
        state.currentBids = {};
        state.phase = 'MAIN';
    }
}