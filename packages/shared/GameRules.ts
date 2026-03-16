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
    // 必要に応じて updatedAt などもここに入れる
}

// エンジンがアクションを識別するための最低限の約束
export interface BaseGameAction {
    type: string;
    playerId?: string; // サーバー側で検証・付与された送信元のユーザーID
    timestamp?: number; // アクションが発生した時刻
}

export interface GameRuleset<TState extends BaseGameState, TAction extends BaseGameAction> {
    // ゲームの初期状態を生成する関数
    getInitialState: (options?: any) => TState;

    // そのアクションが現在の状態で「合法手」かどうかを判定する関数
    isValidAction: (state: TState, action: TAction) => boolean;

    // アクションを受け取り、新しい状態を返す関数（Reducer）
    reduce: (state: TState, action: TAction) => TState;

    // ゲームが終了したかどうか、誰が勝ったかを判定する関数
    checkWinCondition: (state: TState) => { isFinished: boolean; message?: string };

    // ゲームが終了したかどうか、誰が勝ったかを判定する関数
    applyWinResult?: (state: TState, result: { isFinished: boolean, message?: string }) => TState;

    // 隠匿情報（相手の手牌など）をマスク（伏せた）状態を作成する関数 (オプショナル)
    maskState?: (state: TState, playerId: string) => TState;

    // 制限時間切れの際に自動実行されるアクションを返す関数 (オプショナル)
    getTimeoutAction?: (state: TState) => TAction | null;

    // 特定のプレイヤーが現在実行可能な合法手の完全なリストを返す関数（AI用）
    getLegalActions: (state: TState, playerId: string) => TAction[];
}