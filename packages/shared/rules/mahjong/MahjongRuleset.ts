// packages/shared/rules/MahjongRules.ts
import type { BaseGameState, BaseGameAction, GameRuleset } from '../../GameRules';
import type { IGameRNG } from '../../utils/IGameRNG';
import { MahjongHandEvaluator } from './MahjongHandEvaluator';

// 麻雀の牌表現 (例: 萬子=m, 筒子=p, 索子=s, 字牌=z) 
// '1m' ~ '9m', '1p' ~ '9p', '1s' ~ '9s', '1z' ~ '7z'
export type Tile = string;

export interface MahjongState extends BaseGameState {
    playerIds: string[];         // 参加プレイヤー4人のID順序（起家から順）
    wall: Tile[];                // 山牌
    deadWall: Tile[];            // 王牌 (通常14枚だが簡易化のため配列で保持)
    doraIndicators: Tile[];      // ドラ表示牌
    hands: Record<string, Tile[]>; // 各プレイヤーごとの手牌（IDキー）
    discards: Record<string, Tile[]>; // 各プレイヤーの捨て牌、いわゆる「河」（IDキー）
    melds: Record<string, any[]>;     // 鳴き・副露の情報（簡易化のため any[]）

    // 局の進行状態
    wind: 'EAST' | 'SOUTH' | 'WEST' | 'NORTH'; // 場風
    round: number; // 局（1局目=1, 2局目=2...）
    turnIndex: number; // 現在のターンプレイヤーのインデックス(0~3)

    // 点数
    scores: Record<string, number>;

    // 【重要】割り込みアクション（鳴き、ロン）待ちの状態
    pendingDiscard?: {
        playerId: string; // 牌を捨てた人のID
        tile: Tile;       // 捨てられた牌
        // すべてのプレイヤーからの返答（パス、鳴き、ロン）をバッファリングする
        pendingActions: { playerId: string; action: MahjongAction }[];
    };
}

export interface MahjongAction extends BaseGameAction {
    type: 'DRAW' | 'DISCARD' | 'CALL' | 'RON' | 'TSUMO' | 'PASS' | 'START';
    tile?: Tile; // 打牌(DISCARD)や鳴き(CALL)の対象となる特定の牌
    meldType?: 'CHI' | 'PON' | 'KAN'; // 鳴きの種類
}

// 簡易的な山牌生成関数
function createWall(rng?: IGameRNG): Tile[] {
    const wall: Tile[] = [];
    const suits = ['m', 'p', 's'];
    const numbers = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];
    const honors = ['1', '2', '3', '4', '5', '6', '7']; // 東南西北白發中 = 1z~7z

    for (let i = 0; i < 4; i++) {
        for (const s of suits) {
            for (const n of numbers) {
                wall.push(`${n}${s}`);
            }
        }
        for (const h of honors) {
            wall.push(`${h}z`);
        }
    }
    // Fisher-Yates shuffle
    for (let i = wall.length - 1; i > 0; i--) {
        const j = rng ? rng.nextInt(0, i) : Math.floor(Math.random() * (i + 1));
        [wall[i], wall[j]] = [wall[j], wall[i]];
    }
    return wall;
}

export const MahjongRuleset: GameRuleset<MahjongState, MahjongAction> = {
    getInitialState: (options: any, rng?: IGameRNG): MahjongState => {
        const opts = options || {};
        const playerIds = (opts.playerIds || []).filter((id: any) => !!id);

        return {
            status: 'WAITING',
            players: playerIds.length > 0
                ? playerIds.reduce((acc: Record<string, string>, p: string) => ({ ...acc, [p]: p }), {})
                : { 0: null, 1: null, 2: null, 3: null },
            playerIds,
            activePlayers: [],
            turnIndex: 0,
            wall: [],
            deadWall: [],
            doraIndicators: [],
            hands: {},
            discards: {},
            melds: {},
            wind: 'EAST',
            round: 1,
            scores: {}
        };
    },

    isValidAction: (state: MahjongState, action: MahjongAction): boolean => {
        const pId = action.playerId!;

        if (action.type === 'START') {
            // 4人揃っているときだけ開始可能
            const joinedPlayers = Object.values(state.players || {}).filter(p => p !== null);
            const isUninitialized = Object.keys(state.hands || {}).length === 0;
            return (state.status === 'WAITING' || (state.status === 'PLAYING' && isUninitialized)) && joinedPlayers.length === 4;
        }

        if (state.status !== 'PLAYING') return false;

        // --- A. 割り込み待ち（誰かの打牌直後）状態の場合 ---
        if (state.pendingDiscard) {
            // 打牌した本人以外がアクション可能
            if (pId === state.pendingDiscard.playerId) return false;
            // 既にアクション済みなら不可（1人1回まで）
            if (state.pendingDiscard.pendingActions.some(a => a.playerId === pId)) return false;

            // 許容されるアクションは「鳴き」「ロン」「パス」のみ
            if (['CALL', 'RON', 'PASS'].includes(action.type)) {
                return true;
            }
            return false;
        }

        // --- B. 通常の手番（ツモ後）状態の場合 ---
        if (!state.activePlayers || !state.activePlayers.includes(pId)) return false;

        switch (action.type) {
            case 'DRAW':
                // 山から引くフェーズかチェック
                const hand = state.hands[pId] || [];
                return hand.length === 13;
            case 'DISCARD':
                if (!action.tile) return false;
                const h = state.hands[pId] || [];
                return h.includes(action.tile) && h.length === 14;
            case 'TSUMO':
                const tsHand = state.hands[pId] || [];
                return tsHand.length === 14;
            case 'CALL': // 暗槓や加槓
                return true; 
            default:
                return false;
        }
    },

    reduce: (state: MahjongState, action: MahjongAction, rng?: IGameRNG): MahjongState => {
        if (action.type === 'START') {
            const playerIds = Object.values(state.players || {}).filter(p => p !== null) as string[];
            const wall = createWall(rng);
            const deadWall: Tile[] = [];
            const doraIndicators: Tile[] = [];
            const hands: Record<string, Tile[]> = {};
            const discards: Record<string, Tile[]> = {};
            const melds: Record<string, any[]> = {};
            const scores: Record<string, number> = {};

            // 王牌を14枚分確保
            for (let i = 0; i < 14; i++) {
                deadWall.push(wall.pop()!);
            }
            doraIndicators.push(deadWall.pop()!);

            for (const pId of playerIds) {
                scores[pId] = 25000;
                discards[pId] = [];
                melds[pId] = [];
                const hand: Tile[] = [];
                for (let i = 0; i < 13; i++) {
                    hand.push(wall.pop()!);
                }
                hands[pId] = hand.sort();
            }

            return {
                ...state,
                status: 'PLAYING',
                playerIds,
                wall,
                deadWall,
                doraIndicators,
                hands,
                discards,
                melds,
                scores,
                turnIndex: 0,
                activePlayers: [playerIds[0]], // 東家から開始
            };
        }

        const newState: MahjongState = {
            ...state,
            scores: { ...state.scores },
            hands: { ...state.hands },
            discards: { ...state.discards },
            melds: { ...state.melds },
            pendingDiscard: state.pendingDiscard ? {
                ...state.pendingDiscard,
                pendingActions: [...state.pendingDiscard.pendingActions]
            } : undefined
        };
        const pId = action.playerId!;

        // 割り込み待ち処理の解決ロジック
        if (newState.pendingDiscard) {
            newState.pendingDiscard.pendingActions.push({ playerId: pId, action });

            if (newState.pendingDiscard.pendingActions.length === 3) {
                const actions = newState.pendingDiscard.pendingActions;
                const tile = newState.pendingDiscard.tile;

                const rons = actions.filter(a => a.action.type === 'RON');
                const pankan = actions.filter(a => a.action.type === 'CALL' && (a.action.meldType === 'PON' || a.action.meldType === 'KAN'));
                const chi = actions.filter(a => a.action.type === 'CALL' && a.action.meldType === 'CHI');

                if (rons.length > 0) {
                    newState.status = 'FINISHED';
                    let messages: string[] = [];
                    for (const ronAction of rons) {
                        const winnerId = ronAction.playerId;
                        const handWithWinTile = [...newState.hands[winnerId], tile];
                        const result = MahjongHandEvaluator.evaluate(handWithWinTile, newState.melds[winnerId], tile, false, newState);
                        if (result.isAgari) {
                            newState.scores[winnerId] += result.ten;
                            newState.scores[newState.pendingDiscard!.playerId] -= result.ten;
                            messages.push(`Player ${winnerId} won by RON! [${result.ten}pts]`);
                        }
                    }
                    newState.message = messages.length > 0 ? messages.join(' | ') : "Game Over";
                    newState.pendingDiscard = undefined;
                    return newState;
                }

                if (pankan.length > 0) {
                    const winner = pankan[0];
                    newState.melds[winner.playerId].push({ type: winner.action.meldType, tile });
                    newState.turnIndex = newState.playerIds.indexOf(winner.playerId);
                    newState.activePlayers = [winner.playerId];
                    newState.pendingDiscard = undefined;
                    return newState;
                }

                if (chi.length > 0) {
                    const winner = chi[0];
                    newState.melds[winner.playerId].push({ type: winner.action.meldType, tile });
                    newState.turnIndex = newState.playerIds.indexOf(winner.playerId);
                    newState.activePlayers = [winner.playerId];
                    newState.pendingDiscard = undefined;
                    return newState;
                }

                newState.pendingDiscard = undefined;
                newState.turnIndex = (newState.turnIndex + 1) % 4;
                newState.activePlayers = [newState.playerIds[newState.turnIndex]];
            }
            return newState;
        }

        switch (action.type) {
            case 'DRAW':
                const drawTile = newState.wall.pop();
                if (!drawTile) {
                    newState.status = 'FINISHED';
                    newState.message = "Game drawn (No tiles left).";
                    return newState;
                }
                newState.hands[pId].push(drawTile);
                break;

            case 'DISCARD':
                const idx = newState.hands[pId].indexOf(action.tile!);
                newState.hands[pId].splice(idx, 1);
                newState.discards[pId].push(action.tile!);
                newState.pendingDiscard = {
                    playerId: pId,
                    tile: action.tile!,
                    pendingActions: []
                };
                newState.activePlayers = newState.playerIds.filter(id => id !== pId);
                newState.turnDeadline = Date.now() + 10000; 
                break;

            case 'TSUMO':
                const winningTile = newState.hands[pId][newState.hands[pId].length - 1];
                const tsResult = MahjongHandEvaluator.evaluate(
                    newState.hands[pId],
                    newState.melds[pId],
                    winningTile,
                    true,
                    newState
                );
                newState.status = 'FINISHED';
                if (tsResult.isAgari) {
                    const paymentPerPlayer = Math.ceil(tsResult.ten / 3);
                    for (const otherId of newState.playerIds) {
                        if (otherId !== pId) newState.scores[otherId] -= paymentPerPlayer;
                    }
                    newState.scores[pId] += paymentPerPlayer * 3;
                    newState.message = `Player ${pId} won by TSUMO! [${tsResult.ten}pts]`;
                } else {
                    newState.message = `Player ${pId} claimed TSUMO, but hand is invalid.`;
                }
                break;
        }
        return newState;
    },

    checkWinCondition: (state: MahjongState) => {
        if (state.status === 'FINISHED') {
            const winnerIds: string[] = [];
            // メッセージから勝者を特定（RON! または TSUMO! の直前のプレイヤー名）
            const match = state.message?.match(/Player (.+?) won/);
            if (match) {
                winnerIds.push(match[1]);
            }
            return { isFinished: true, winnerIds, message: state.message || 'Game finished.' };
        }
        return { isFinished: false };
    },

    maskState: (state: MahjongState, targetPlayerId: string): MahjongState => {
        const maskedHands: Record<string, Tile[]> = {};
        for (const [pId, hand] of Object.entries(state.hands)) {
            maskedHands[pId] = (pId === targetPlayerId) ? hand : hand.map(() => '?');
        }
        return {
            ...state,
            hands: maskedHands,
            wall: state.wall.map(() => '?'),
            deadWall: state.deadWall.map(() => '?')
        };
    },

    getTimeoutAction: (state: MahjongState): MahjongAction | null => {
        if (!state.pendingDiscard || !state.turnDeadline) return null;
        if (Date.now() > state.turnDeadline) {
            return { type: 'PASS', playerId: state.activePlayers![0] };
        }
        return null;
    },

    getLegalActions: (state: MahjongState, playerId: string): MahjongAction[] => {
        if (state.status === 'WAITING') {
            const startAction = { type: 'START', playerId } as MahjongAction;
            return MahjongRuleset.isValidAction(state, startAction) ? [startAction] : [];
        }
        if (state.status !== 'PLAYING') return [];
        const actions: MahjongAction[] = [];

        if (state.pendingDiscard && state.pendingDiscard.playerId !== playerId) {
            if (!state.pendingDiscard.pendingActions.some(a => a.playerId === playerId)) {
                const interruptActions: MahjongAction[] = [
                    { type: 'PASS', playerId },
                    { type: 'RON', playerId },
                    { type: 'CALL', meldType: 'PON', tile: state.pendingDiscard.tile, playerId },
                    { type: 'CALL', meldType: 'CHI', tile: state.pendingDiscard.tile, playerId },
                    { type: 'CALL', meldType: 'KAN', tile: state.pendingDiscard.tile, playerId }
                ];
                for (const a of interruptActions) if (MahjongRuleset.isValidAction(state, a)) actions.push(a);
                return actions;
            }
        }

        if (!state.activePlayers || !state.activePlayers.includes(playerId)) return [];

        const drawAction: MahjongAction = { type: 'DRAW', playerId };
        if (MahjongRuleset.isValidAction(state, drawAction)) actions.push(drawAction);

        if (state.hands[playerId]) {
            const uniqueTiles = Array.from(new Set(state.hands[playerId]));
            for (const tile of uniqueTiles) {
                const discardAction: MahjongAction = { type: 'DISCARD', tile, playerId };
                if (MahjongRuleset.isValidAction(state, discardAction)) actions.push(discardAction);
            }
            const tsumoAction: MahjongAction = { type: 'TSUMO', playerId };
            if (MahjongRuleset.isValidAction(state, tsumoAction)) actions.push(tsumoAction);
        }

        return actions;
    },

    applyWinResult: (state, winResult) => {
        return {
            ...state,
            status: 'FINISHED',
            message: winResult.message ?? state.message,
            activePlayers: [],
        };
    }
};
