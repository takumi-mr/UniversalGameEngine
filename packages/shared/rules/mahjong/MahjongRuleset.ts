// packages/shared/rules/MahjongRules.ts
import type { BaseGameState, BaseGameAction, GameRuleset } from '../../UniversalEngine';
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
    type: 'DRAW' | 'DISCARD' | 'CALL' | 'RON' | 'TSUMO' | 'PASS';
    tile?: Tile; // 打牌(DISCARD)や鳴き(CALL)の対象となる特定の牌
    meldType?: 'CHI' | 'PON' | 'KAN'; // 鳴きの種類
}

// 簡易的な山牌生成関数
function createWall(): Tile[] {
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
    // 簡易シャッフル
    return wall.sort(() => Math.random() - 0.5);
}

export const MahjongRuleset: GameRuleset<MahjongState, MahjongAction> = {
    getInitialState: (options: any): MahjongState => {
        const opts = options || {};
        const playerIds = (opts.playerIds || []).filter((id: any) => !!id);
        // 初期状態作成時はまだ参加プレイヤーが揃っていない可能性があるため、エラーにせず空の参加枠を許可する
        // if (playerIds.length !== 4) throw new Error("Mahjong requires exactly 4 players.");

        const wall = createWall();
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

        // ドラ表示牌をめくる（王牌から1枚）
        doraIndicators.push(deadWall.pop()!);

        // 各プレイヤーに13枚ずつ配る
        if (playerIds.length > 0) {
            for (const pId of playerIds) {
                scores[pId] = 25000; // 原点25000
                discards[pId] = [];
                melds[pId] = [];
                const initialHand: Tile[] = [];
                for (let i = 0; i < 13; i++) {
                    const t = wall.pop();
                    if (t) initialHand.push(t);
                }
                hands[pId] = initialHand.sort(); // 簡易ソート
            }
        }

        return {
            status: 'WAITING',
            players: playerIds.length > 0
                ? playerIds.reduce((acc: Record<string, string>, p: string) => ({ ...acc, [p]: p }), {})
                : { 0: null, 1: null, 2: null, 3: null },
            playerIds,
            activePlayers: playerIds.length > 0 ? [playerIds[0]] : [],
            turnIndex: 0,
            wall,
            deadWall,
            doraIndicators,
            hands,
            discards,
            melds,
            wind: 'EAST',
            round: 1,
            scores
        };
    },

    isValidAction: (state: MahjongState, action: MahjongAction): boolean => {
        if (state.status !== 'PLAYING') return false;
        const pId = action.playerId!;

        // --- A. 割り込み待ち（誰かの打牌直後）状態の場合 ---
        if (state.pendingDiscard) {
            // 打牌した本人以外がアクション可能
            if (pId === state.pendingDiscard.playerId) return false;
            // 既にアクション済みなら不可（1人1回まで）
            if (state.pendingDiscard.pendingActions.some(a => a.playerId === pId)) return false;

            // 허容されるアクションは「鳴き」「ロン」「パス」のみ
            if (['CALL', 'RON', 'PASS'].includes(action.type)) {
                // 厳密にはここで「鳴ける牌姿か？」というチェックが必要だが今回は省略しTrueを返す
                return true;
            }
            return false;
        }

        // --- B. 通常の手番（ツモ後）状態の場合 ---
        if (!state.activePlayers || !state.activePlayers.includes(pId)) return false;

        switch (action.type) {
            case 'DRAW':
                // ツモ番の人が、手牌が13枚(または副露による規定枚数－1)のときに引ける
                // （簡易的に `turnIndex` の人が引くフェーズかチェック）
                return true;
            case 'DISCARD':
                // アクション対象の牌を実際に持っているかチェック
                if (!action.tile) return false;
                const hand = state.hands[pId];
                return hand.includes(action.tile);
            case 'TSUMO':
            case 'CALL': // 暗槓や加槓
                return true; // 簡略化
            default:
                return false;
        }
    },

    reduce: (state: MahjongState, action: MahjongAction): MahjongState => {
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
            // アクションをバッファに保存
            newState.pendingDiscard.pendingActions.push({ playerId: pId, action });

            // 打牌者以外の3人全員からアクションが届いた場合、優先度を解決して確定させる
            // (本来はRON>PON/KAN>CHIの順で、ポンが出たらチーを待たない等の最適化も可能だが簡略化)
            if (newState.pendingDiscard.pendingActions.length === 3) {
                const actions = newState.pendingDiscard.pendingActions;
                const tile = newState.pendingDiscard.tile;

                // 優先度分類
                const rons = actions.filter(a => a.action.type === 'RON');
                const pankan = actions.filter(a => a.action.type === 'CALL' && (a.action.meldType === 'PON' || a.action.meldType === 'KAN'));
                const chi = actions.filter(a => a.action.type === 'CALL' && a.action.meldType === 'CHI');

                // 1. ロン (複数人ロン=ダブロン対応)
                if (rons.length > 0) {
                    newState.status = 'FINISHED';
                    let messages: string[] = [];

                    for (const ronAction of rons) {
                        const winnerId = ronAction.playerId;
                        // アガリ形を組み立てる（手牌 + ロンした牌）
                        const handWithWinTile = [...newState.hands[winnerId], tile];
                        const melds = newState.melds[winnerId];

                        // 役・点数計算
                        const result = MahjongHandEvaluator.evaluate(handWithWinTile, melds, tile, false, newState);

                        if (result.isAgari) {
                            // 簡易的な点数移動 (ロン: 振り込んだ人から全額)
                            newState.scores[winnerId] += result.ten;
                            newState.scores[pId] -= result.ten;

                            const yakuStr = Object.keys(result.yaku).join(', ');
                            messages.push(`Player ${winnerId} won by RON! [${result.ten}pts - ${yakuStr}]`);
                        } else {
                            messages.push(`Player ${winnerId} claimed RON, but hand is invalid (Chombo).`);
                        }
                    }

                    newState.message = messages.join(' | ');
                    newState.pendingDiscard = undefined;
                    return newState;
                }

                // 2. ポン / カン
                if (pankan.length > 0) {
                    // 同時ポンはあり得ないので最初の1つを採用
                    const winner = pankan[0];
                    newState.melds[winner.playerId].push({ type: winner.action.meldType, tile });
                    newState.turnIndex = newState.playerIds.indexOf(winner.playerId);
                    newState.activePlayers = [winner.playerId];
                    newState.pendingDiscard = undefined;
                    newState.turnDeadline = undefined;
                    return newState;
                }

                // 3. チー
                if (chi.length > 0) {
                    const winner = chi[0];
                    newState.melds[winner.playerId].push({ type: winner.action.meldType, tile });
                    newState.turnIndex = newState.playerIds.indexOf(winner.playerId);
                    newState.activePlayers = [winner.playerId];
                    newState.pendingDiscard = undefined;
                    newState.turnDeadline = undefined;
                    return newState;
                }

                // 4. 全員パスの場合は通常通り次のツモ番へ
                newState.pendingDiscard = undefined;
                newState.turnIndex = (newState.turnIndex + 1) % 4;
                newState.activePlayers = [newState.playerIds[newState.turnIndex]];
                newState.turnDeadline = undefined;
            }
            return newState;
        }

        // 通常の手番の処理
        switch (action.type) {
            case 'DRAW':
                // 山から1枚引いて手牌に加える
                const drawTile = newState.wall.pop();
                if (!drawTile) {
                    // 流局
                    newState.status = 'FINISHED';
                    newState.message = "Game drawn (No tiles left).";
                    return newState;
                }
                newState.hands[pId].push(drawTile);
                break;

            case 'DISCARD':
                // 1. 手牌から指定された牌を削除する
                const idx = newState.hands[pId].indexOf(action.tile!);
                newState.hands[pId].splice(idx, 1);

                // 2. 捨て牌（河）に追加
                newState.discards[pId].push(action.tile!);

                // 3. 【重要】非同期の「鳴き・ロン」割り込み待ち状態へ移行する
                //   ここで次の手番へは進めず、`activePlayers` を「自分以外の3人全員」に変更する。
                //   また、待機制限時間（例：5秒後）を設定する。
                newState.pendingDiscard = {
                    playerId: pId,
                    tile: action.tile!,
                    pendingActions: []
                };
                newState.activePlayers = newState.playerIds.filter(id => id !== pId);
                newState.turnDeadline = Date.now() + 5000; // 5秒の考慮時間

                break;

            case 'TSUMO':
                // アガリ牌は既に手牌に入っている最後の牌とする（厳密にはDRAWで保持しておくべきだが簡略化）
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
                    // 簡易的な点数移動 (ツモ: 他の3人から等分で払う。親/子の厳密な計算はライブラリの戻り値等に依存)
                    const paymentPerPlayer = Math.ceil(tsResult.ten / 3);

                    for (const otherId of newState.playerIds) {
                        if (otherId !== pId) {
                            newState.scores[otherId] -= paymentPerPlayer;
                        }
                    }
                    // アガリ者は総額を受け取る
                    newState.scores[pId] += paymentPerPlayer * 3;

                    const yakuStr = Object.keys(tsResult.yaku).join(', ');
                    newState.message = `Player ${pId} won by TSUMO! [${tsResult.ten}pts - ${yakuStr}]`;
                } else {
                    newState.message = `Player ${pId} claimed TSUMO, but hand is invalid (Chombo).`;
                }
                break;
        }

        return newState;
    },

    checkWinCondition: (state: MahjongState) => {
        // state 内部で FINISHED に変わっていればそれを返す
        if (state.status === 'FINISHED') {
            return {
                isFinished: true,
                message: state.message || 'Game finished.'
            };
        }
        return { isFinished: false };
    },

    // 隠匿情報（相手の手牌・山牌など）をマスクするフック！
    maskState: (state: MahjongState, targetPlayerId: string): MahjongState => {
        const maskedHands: Record<string, Tile[]> = {};

        for (const [pId, hand] of Object.entries(state.hands)) {
            if (pId === targetPlayerId) {
                // 自分の手牌はそのまま見せる
                maskedHands[pId] = hand;
            } else {
                // 他人の手牌は "?" にして裏向き牌として扱う
                maskedHands[pId] = hand.map(() => '?');
            }
        }

        const maskedState: MahjongState = {
            ...state,
            hands: maskedHands,
            // 山牌(wall)や王牌(deadWall)の中身も「枚数だけの"?"の配列」にする
            wall: state.wall.map(() => '?'),
            deadWall: state.deadWall.map(() => '?')
        };

        return maskedState;
    },

    // 制限時間（ポン・チー待機時間）を超過した場合の自動アクション
    getTimeoutAction: (state: MahjongState): MahjongAction | null => {
        if (!state.pendingDiscard || !state.turnDeadline) return null;

        // タイムアウト時間を過ぎていたら「全員強制PASS」相当のアクションを返す
        if (Date.now() > state.turnDeadline) {
            // 実装上は、サーバー側のループがこの自動アクションを dispatch して状態を進める想定
            // 誰のplayerIdにするかは任意（システムとして）
            return {
                type: 'PASS',
                // 未選択の最初のプレイヤーなどを仮指定するか、システムIDを設定する
                playerId: state.activePlayers![0]
            };
        }
        return null;
    },

    getLegalActions: (state: MahjongState, playerId: string): MahjongAction[] => {
        if (state.status !== 'PLAYING') return [];
        const actions: MahjongAction[] = [];

        // 割り込み系 (RON, PASS, CALL) の待機中か？
        if (state.pendingDiscard && state.pendingDiscard.playerId !== playerId) {
            const hasActed = state.pendingDiscard.pendingActions.some(a => a.playerId === playerId);
            if (!hasActed) {
                const interruptActions: MahjongAction[] = [
                    { type: 'PASS', playerId },
                    { type: 'RON', playerId },
                    { type: 'CALL', meldType: 'PON', tile: state.pendingDiscard.tile, playerId },
                    { type: 'CALL', meldType: 'CHI', tile: state.pendingDiscard.tile, playerId },
                    { type: 'CALL', meldType: 'KAN', tile: state.pendingDiscard.tile, playerId }
                ];
                for (const a of interruptActions) {
                     if (MahjongRuleset.isValidAction(state, a)) actions.push(a);
                }
                return actions;
            }
        }

        // 通常手番か？
        if (!state.activePlayers || !state.activePlayers.includes(playerId)) return [];

        // 1. DRAW
        const drawAction: MahjongAction = { type: 'DRAW', playerId };
        if (MahjongRuleset.isValidAction(state, drawAction)) actions.push(drawAction);

        // 2. DISCARD (手牌にある全種類の牌)
        if (state.hands[playerId]) {
            const uniqueTiles = Array.from(new Set(state.hands[playerId]));
            for (const tile of uniqueTiles) {
                const discardAction: MahjongAction = { type: 'DISCARD', tile, playerId };
                if (MahjongRuleset.isValidAction(state, discardAction)) actions.push(discardAction);
            }
            
            // 3. TSUMO
            const tsumoAction: MahjongAction = { type: 'TSUMO', playerId };
            if (MahjongRuleset.isValidAction(state, tsumoAction)) actions.push(tsumoAction);
        }
        
        return actions;
    },

    applyWinResult: (state, winResult) => {
        // 麻雀では RON/TSUMO によるアガリ処理（点棒移動）は reduce 内ですでに完結している。
        // ここでは status と activePlayers を整理するだけでよい。
        return {
            ...state,
            status: 'FINISHED',
            message: winResult.message ?? state.message,
            activePlayers: [],
        };
    }
};
