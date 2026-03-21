// --- 1. エンジンが要求する「ルールの文法（契約）」 ---
// エンジンが状態を扱うための最低限の約束
export interface BaseGameState {
    status: 'WAITING' | 'PLAYING' | 'FINISHED';
    message?: string;
    // { "1": "userIdA", "-1": "userIdB" } のようにロールとユーザーIDをマッピング
    players?: Record<string | number, string | null>;
    // アクティブな（現在手番・アクションを起こす権限がある）プレイヤーのIDリスト
    activePlayers?: string[];
    // ターンの制限時間（タイムスタンプ）。麻雀などの割り込みアクション（ポン・チー）待機時間に有用
    turnDeadline?: number;
    // 状態のバージョン（差分更新の一貫性チェック用）
    version?: number;
    // 状態のハッシュ値（デスキンス検知用）
    hash?: string;
    // 乱数生成器の設定（Provably Fair用）
    prngConfig?: {
        serverSeedHash: string;
        clientSeed: string;
        nonce: number;
    };
}

// エンジンがアクションを識別するための最低限の約束
export interface BaseGameAction {
    type: string;
    playerId?: string; // サーバー側で検証・付与された送信元のユーザーID
    timestamp?: number; // アクションが発生した時刻
}

// 勝敗結果を表す専用の型
export interface GameResult {
    isFinished: boolean;
    // 勝利したプレイヤーのIDリスト。
    // undefined: 勝敗未決 (isFinished: false時)
    // []: 引き分け (isFinished: true時)
    // ["playerId"]: 単独勝利
    // ["playerId1", "playerId2"]: 同時勝利（ゲームによる）
    winnerIds?: string[];
    message?: string;
}

/**
 * 閲覧制限のある情報を包むラッパー型
 * エンジンはこの型を見つけると、対象プレイヤー以外に対して自動的にマスク処理を行う。
 */
export interface Secret<T> {
    __isSecret: true;
    value: T;
    // 閲覧可能なプレイヤーIDのリスト。 "*" は全員。
    visibleTo: string[];
    // マスク時の代替値。未指定の場合はデフォルト（"?" など）が使用される
    maskedValue?: any;
}

export function createSecret<T>(value: T, visibleTo: string[], maskedValue?: any): Secret<T> {
    return { __isSecret: true, value, visibleTo, maskedValue };
}

export function isSecret(obj: any): obj is Secret<any> {
    return !!(obj && typeof obj === 'object' && (obj as any).__isSecret === true);
}

import type { IGameRNG } from "./utils/IGameRNG";

export interface GameRuleset<TState extends BaseGameState, TAction extends BaseGameAction> {
    // ゲームの初期状態を生成する関数
    getInitialState: (options?: any, rng?: IGameRNG) => TState;

    // そのアクションが現在の状態で「合法手」かどうかを判定する関数
    isValidAction: (state: TState, action: TAction) => boolean;

    // アクションを受け取り、新しい状態を返す関数（Reducer）
    reduce: (state: TState, action: TAction, rng?: IGameRNG) => TState;

    // ゲームが終了したかどうか、誰が勝ったかを判定する関数
    checkWinCondition: (state: TState) => GameResult;

    // ゲームが終了したかどうか、誰が勝ったかを判定する関数
    applyWinResult?: (state: TState, result: GameResult) => TState;

    /**
     * @deprecated Secret<T>に移行
     * 隠匿情報（相手の手牌など）をマスク（伏せた）状態を作成する関数 (オプショナル)
     */
    maskState?: (state: TState, playerId: string) => TState;

    // 制限時間切れの際に自動実行されるアクションを返す関数 (オプショナル)
    getTimeoutAction?: (state: TState) => TAction | null;

    // 特定のプレイヤーが現在実行可能な合法手の完全なリストを返す関数（AI用）
    getLegalActions: (state: TState, playerId: string) => TAction[];
}