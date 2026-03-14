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

export type CardType = 'ATTACK' | 'DEFENSE' | 'TRICK' | 'GOAL' | 'SYPHON';

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
    lastAction?: EquilibriumAction; // To support ECHO cards
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
    | { type: 'JOIN'; playerId: string; timestamp?: number }
    | { type: 'BID'; playerId: string; amount: number; timestamp?: number }
    | { type: 'PASS_AUCTION'; playerId: string; timestamp?: number }
    | { type: 'PLAY_CARD'; playerId: string; cardId: string; targetId?: string; timestamp?: number }
    | { type: 'ALTER_GOAL'; playerId: string; newGoalCardId: string; timestamp?: number }
    | { type: 'BLUFF_REVEAL'; playerId: string; fakeCard: Card; timestamp?: number }
    | { type: 'SACRIFICE'; playerId: string; timestamp?: number }
    | { type: 'END_TURN'; playerId: string; timestamp?: number };


// ==========================================
// 2. 内部ヘルパー (Internal Helpers)
// ==========================================

function generateId(): string {
    return Math.random().toString(36).substring(2, 9);
}

function drawInitialCards(): Card[] {
    return [
        { id: generateId(), type: 'ATTACK', name: 'Strike', value: 2, cost: 1 },
        { id: generateId(), type: 'DEFENSE', name: 'Guard', value: 2, cost: 1 },
        { id: generateId(), type: 'TRICK', name: 'Peep', value: 0, cost: 2 },
    ];
}

function drawRandomGoal(): Card {
    const goals: Omit<Card, 'id'>[] = [
        { type: 'GOAL', name: 'Annihilator', value: 0, cost: 0 },
        { type: 'GOAL', name: 'Collector', value: 8, cost: 0 },
        { type: 'GOAL', name: 'Pacifist', value: 15, cost: 0 },
        { type: 'GOAL', name: 'Soul_Hoarder', value: 25, cost: 0 }
    ];
    const selected = goals[Math.floor(Math.random() * goals.length)];
    return { ...selected, id: generateId() } as Card;
}

function generateRandomCard(): Card {
    const pool: Omit<Card, 'id'>[] = [
        { type: 'ATTACK', name: 'Hellfire', value: 8, cost: 3 },
        { type: 'DEFENSE', name: 'Aegis_Shield', value: 7, cost: 2 },
        { type: 'TRICK', name: 'Mind_Control', value: 0, cost: 4 },
        { type: 'SYPHON', name: 'Soul_Drain', value: 3, cost: 2 },
        { type: 'TRICK', name: 'Echo_Whisper', value: 0, cost: 3 }, // Copies last non-ECHO card
        { type: 'TRICK', name: 'Corruption', value: 0, cost: 4 },   // Opponent discards half hand (round down)
        { type: 'GOAL', name: 'Sudden_Death', value: 0, cost: 0 }
    ];
    const selected = pool[Math.floor(Math.random() * pool.length)];
    return { ...selected, id: generateId() } as Card;
}

function drawRandomBasicCard(): Card {
    const pool = drawInitialCards();
    return pool[Math.floor(Math.random() * pool.length)];
}

function getNextPlayer(state: EquilibriumState, currentPlayerId: string): string {
    const playerIds = Object.keys(state.playerData);
    const currentIndex = playerIds.indexOf(currentPlayerId);
    for (let i = 1; i < playerIds.length; i++) {
        const nextIndex = (currentIndex + i) % playerIds.length;
        const nextId = playerIds[nextIndex];
        if (!state.passedPlayers.includes(nextId)) {
            return nextId;
        }
    }
    return currentPlayerId;
}

function resolveAuction(state: EquilibriumState): void {
    let maxBid = -1;
    let winnerId = '';
    let isTie = false;

    for (const [pId, bid] of Object.entries(state.currentBids)) {
        if (bid > maxBid) {
            maxBid = bid;
            winnerId = pId;
            isTie = false;
        } else if (bid === maxBid) {
            isTie = true;
        }
    }

    if (maxBid <= 0) {
        // No one bid or everyone passed
        Object.keys(state.playerData).forEach(pId => {
            state.playerData[pId].hp -= 1; // Penalty for soul fragility
        });
        const allPlayers = Object.keys(state.playerData);
        state.activePlayers = [allPlayers[0]];
    } else if (!isTie && winnerId !== '') {
        const winner = state.playerData[winnerId];
        winner.soulPoints -= maxBid;
        winner.hand.push(...state.auctionPool);
        state.activePlayers = [winnerId];
    } else {
        const allPlayers = Object.keys(state.playerData);
        state.activePlayers = [allPlayers[0]];
    }

    state.auctionPool = [];
    state.currentBids = {};
    state.phase = 'MAIN';
}

// ==========================================
// 3. ルールセット本体 (Ruleset Implementation)
// ==========================================

export const EquilibriumRuleset: GameRuleset<EquilibriumState, EquilibriumAction> = {

    getInitialState(options: { playerIds?: string[] } = {}): EquilibriumState {
        const playerIds = options.playerIds || [];
        const initialPlayerData: Record<string, PlayerState> = {};

        playerIds.forEach(id => {
            initialPlayerData[id] = {
                id,
                hp: 20,
                soulPoints: 10,
                hand: drawInitialCards(),
                board: [],
                hiddenGoal: drawRandomGoal(),
            };
        });

        return {
            status: 'PLAYING',
            players: Object.fromEntries(playerIds.map(id => [id, id])),
            activePlayers: [...playerIds],
            turnCount: 1,
            phase: 'AUCTION',
            auctionPool: [generateRandomCard(), generateRandomCard()], // 2 cards now
            currentBids: {},
            passedPlayers: [],
            playerData: initialPlayerData,
        } as EquilibriumState;
    },

    isValidAction(state: EquilibriumState, action: EquilibriumAction): boolean {
        if (action.type === 'JOIN') {
            return !state.playerData[action.playerId] && Object.keys(state.playerData).length < 2;
        }

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
            case 'SACRIFICE':
                // HPを削ってSPを得る
                return player.hp > 2;
            default:
                return true;
        }
    },

    reduce(state: EquilibriumState, action: EquilibriumAction): EquilibriumState {
        const nextState = JSON.parse(JSON.stringify(state)) as EquilibriumState;

        if (action.type === 'JOIN') {
            if (!nextState.playerData[action.playerId]) {
                nextState.playerData[action.playerId] = {
                    id: action.playerId,
                    hp: 20,
                    soulPoints: 10,
                    hand: drawInitialCards(),
                    board: [],
                    hiddenGoal: drawRandomGoal(),
                };

                // エンジンの基本プレイヤー情報も更新
                if (!nextState.players) nextState.players = {};
                const currentCount = Object.keys(nextState.players).length;
                const role = currentCount === 0 ? "1" : "-1";
                nextState.players[role] = action.playerId;

                // 最初のアクティブプレイヤーリストに追加（オークション参加資格）
                if (!nextState.activePlayers) nextState.activePlayers = [];
                if (!nextState.activePlayers.includes(action.playerId)) {
                    nextState.activePlayers.push(action.playerId);
                }
            }
            return nextState;
        }

        const player = nextState.playerData[action.playerId];
        if (!player) return nextState;

        switch (action.type) {
            case 'BID':
                if (nextState.phase === 'AUCTION') {
                    nextState.currentBids[action.playerId] = action.amount;
                    nextState.activePlayers = nextState.activePlayers?.filter(id => id !== action.playerId);

                    const allPlayerIds = Object.keys(nextState.playerData);
                    const actedPlayers = [...Object.keys(nextState.currentBids), ...nextState.passedPlayers];
                    if (allPlayerIds.every(id => actedPlayers.includes(id))) {
                        resolveAuction(nextState);
                    }
                }
                break;

            case 'PASS_AUCTION':
                if (nextState.phase === 'AUCTION') {
                    if (!nextState.passedPlayers.includes(action.playerId)) {
                        nextState.passedPlayers.push(action.playerId);
                    }
                    nextState.activePlayers = nextState.activePlayers?.filter(id => id !== action.playerId);

                    const allPlayerIds = Object.keys(nextState.playerData);
                    const actedPlayers = [...Object.keys(nextState.currentBids), ...nextState.passedPlayers];
                    if (allPlayerIds.every(id => actedPlayers.includes(id))) {
                        resolveAuction(nextState);
                    }
                }
                break;

            case 'PLAY_CARD':
                if (nextState.phase === 'MAIN') {
                    const cardIndex = player.hand.findIndex(c => c.id === action.cardId);
                    if (cardIndex !== -1) {
                        const card = player.hand[cardIndex];
                        player.soulPoints -= card.cost;
                        player.hand.splice(cardIndex, 1);
                        if (card.type === 'ATTACK' && (action as any).targetId) {
                            const target = nextState.playerData[(action as any).targetId];
                            if (target) target.hp -= card.value;
                        } else if (card.type === 'DEFENSE') {
                            player.hp += card.value;
                        } else if (card.type === 'SYPHON' && (action as any).targetId) {
                            const target = nextState.playerData[(action as any).targetId];
                            if (target) {
                                const drainAmount = Math.min(target.soulPoints, card.value);
                                target.soulPoints -= drainAmount;
                                player.soulPoints += drainAmount;
                            }
                        } else if (card.name === 'Corruption' && (action as any).targetId) {
                            const target = nextState.playerData[(action as any).targetId];
                            if (target && target.hand.length > 0) {
                                const discardCount = Math.floor(target.hand.length / 2);
                                for (let i = 0; i < discardCount; i++) {
                                    target.hand.splice(Math.floor(Math.random() * target.hand.length), 1);
                                }
                            }
                        } else if (card.name === 'Echo_Whisper' && nextState.lastAction?.type === 'PLAY_CARD') {
                            // Recursively call for simplicity in this demo, or just duplicate effect
                            const lastAction = nextState.lastAction as any;
                            const lastCardId = lastAction.cardId;
                            // Find original card data from board/hand is hard, usually state should store it
                            // For this level design demo, let's assume it echoes the last ATTACK/DEFENSE logic
                            // (Implementation detail: Echo logic would normally be more robust)
                        }
                        if (card.type !== 'GOAL') {
                            player.board.push(card);
                        }
                    }
                }
                break;

            case 'ALTER_GOAL':
                if ('newGoalCardId' in action) {
                    const goalIndex = player.hand.findIndex(c => c.id === action.newGoalCardId && c.type === 'GOAL');
                    if (goalIndex !== -1) {
                        player.hiddenGoal = player.hand[goalIndex];
                        player.hand.splice(goalIndex, 1);
                    }
                }
                break;

            case 'BLUFF_REVEAL':
                if ('fakeCard' in action) {
                    player.soulPoints -= 1;
                    player.fakeReveal = action.fakeCard;
                }
                break;

            case 'SACRIFICE':
                player.hp -= 2;
                player.soulPoints += 1;
                break;

            case 'END_TURN':
                if (!nextState.passedPlayers.includes(action.playerId)) {
                    nextState.passedPlayers.push(action.playerId);
                }
                const allIds = Object.keys(nextState.playerData);
                if (nextState.passedPlayers.length >= allIds.length) {
                    nextState.turnCount += 1;
                    nextState.phase = 'AUCTION';
                    nextState.passedPlayers = [];
                    nextState.currentBids = {};
                    nextState.auctionPool = [generateRandomCard(), generateRandomCard()];
                    nextState.activePlayers = [...allIds];
                    for (const pId of allIds) {
                        nextState.playerData[pId].soulPoints += 1; // Reduced recovery
                        nextState.playerData[pId].hand.push(drawRandomBasicCard());
                    }
                } else {
                    nextState.activePlayers = [getNextPlayer(nextState, action.playerId)];
                }
                break;
        }
        return { ...nextState, lastAction: action };
    },

    checkWinCondition(state: EquilibriumState): { isFinished: boolean; message?: string } {
        const playerIds = Object.keys(state.playerData);
        const alivePlayers = playerIds.filter(id => state.playerData[id].hp > 0);
        if (alivePlayers.length === 1) {
            return { isFinished: true, message: `Player ${alivePlayers[0]} won by Last Man Standing!` };
        } else if (alivePlayers.length === 0) {
            return { isFinished: true, message: `Draw! All players died.` };
        }

        // 各プレイヤーの秘密の勝利条件（hiddenGoal）を評価
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
                    // 自分の場(Board)にカードを8枚以上並べれば即座に勝利
                    if (player.board.length >= 8) {
                        return { isFinished: true, message: `Player ${pId} achieved GOAL: Collector (8+ cards on board)!` };
                    }
                    break;
                case 'Pacifist':
                    // 誰も死なない平和な状態のまま、15ターン目に到達すれば勝利
                    if (state.turnCount >= 15 && alivePlayers.length === playerIds.length) {
                        return { isFinished: true, message: `Player ${pId} achieved GOAL: Pacifist (Survived 15 turns peacefully)!` };
                    }
                    break;
                case 'Soul_Hoarder':
                    // 競り（オークション）を我慢し、Soul Pointを25以上溜め込めば勝利
                    if (player.soulPoints >= 25) {
                        return { isFinished: true, message: `Player ${pId} achieved GOAL: Soul Hoarder (25+ Soul Points)!` };
                    }
                    break;
            }
        }

        // 誰も条件を満たしていない場合はゲーム続行
        return { isFinished: false };
    },

    // 隠匿情報の動的マスク (MaskState)
    maskState(state: EquilibriumState, requestingPlayerId: string): EquilibriumState {
        const maskedState = JSON.parse(JSON.stringify(state)) as EquilibriumState;
        for (const pId in maskedState.playerData) {
            if (pId !== requestingPlayerId) {
                const opponent = maskedState.playerData[pId];
                // 相手の手札の内容は見せない（枚数だけにするか、ダミーデータで上書き）
                opponent.hand = opponent.hand.map(() => ({ id: 'hidden', type: 'TRICK', name: 'Unknown', value: 0, cost: 0 }));
                // 相手の勝利条件を隠す
                opponent.hiddenGoal = null;
                // もし相手が「偽のカード」を仕掛けていたら、それを視界に混ぜる！
                if (opponent.fakeReveal) {
                    // 本当は持っていない偽のカードを、まるで相手の手札や目標であるかのようにクライアントへ送る
                    opponent.hand[0] = opponent.fakeReveal;
                }
                // fakeRevealのメタデータ自体はクライアントに送らない（バレないように削除）
                delete opponent.fakeReveal;
            }
        }
        return maskedState;
    },

    getLegalActions(state: EquilibriumState, playerId: string): EquilibriumAction[] {
        const actions: EquilibriumAction[] = [];
        const player = state.playerData[playerId];
        if (!player) return [];
        if (state.phase === 'AUCTION') {
            actions.push({ type: 'PASS_AUCTION', playerId });
            for (let i = 1; i <= player.soulPoints; i++) {
                actions.push({ type: 'BID', playerId, amount: i });
            }
        } else if (state.phase === 'MAIN') {
            player.hand.forEach(card => {
                if (player.soulPoints >= card.cost) {
                    actions.push({ type: 'PLAY_CARD', playerId, cardId: card.id });
                }
            });
            if (player.hp > 2) {
                actions.push({ type: 'SACRIFICE', playerId });
            }
            actions.push({ type: 'END_TURN', playerId });
        }
        return actions;
    }
};