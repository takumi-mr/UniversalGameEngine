// packages/shared/UniversalEngine.ts
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

// --- 2. 汎用エンジン本体 ---
export class UniversalEngine<TState extends BaseGameState, TAction extends BaseGameAction> {
    private state: TState;
    private rules: GameRuleset<TState, TAction>;
    public history: TAction[] = [];

    constructor(rules: GameRuleset<TState, TAction>, options?: any) {
        this.rules = rules;
        this.state = this.rules.getInitialState(options);
    }

    /**
     * DBなどから取得した外部の状態をエンジンにセットする
     * @param savedState 保存されていた状態
     * @param history 任意：保存されていたアクション履歴
     */
    public loadState(savedState: TState, history: TAction[] = []): void {
        this.state = savedState;
        this.history = history;
    }

    public getState(): TState {
        return this.state;
    }

    /**
     * 隠匿情報（相手の手札や裏向きのカード）など、
     * 特定のプレイヤーに送信するべきではない情報をマスクした状態を返す
     * @param playerId マスク処理の対象となるプレイヤーID
     */
    public getMaskedState(playerId: string): TState {
        if (this.rules.maskState) {
            return this.rules.maskState(this.state, playerId);
        }
        return this.state;
    }

    // クライアントからの通信を受け取る汎用エンドポイント
    public dispatch(action: TAction): boolean {
        // 1. 合法手チェック
        if (!this.rules.isValidAction(this.state, action)) {
            return false;
        }

        // 2. 状態の更新 (Reducerパターン: 副作用を持たせず新しい状態を生成)
        this.state = this.rules.reduce(this.state, action);
        this.history.push(action);

        // 3. 勝敗判定
        const winCheck = this.rules.checkWinCondition(this.state);
        if (winCheck.isFinished) {
            // applyWinResult がある場合はルールセットに委任（スコア精算等）
            if (this.rules.applyWinResult) {
                this.state = this.rules.applyWinResult(this.state, winCheck);
            } else {
                // デフォルト: status と message だけ更新
                this.state = {
                    ...this.state,
                    status: 'FINISHED',
                    message: winCheck.message,
                };
            }
            console.log("Game Finished!", this.state.message);
        }

        return true;
    }

    /**
     * 特定のプレイヤーが現在実行可能な合法手一覧を取得する機能（AIやUI補助用）
     */
    public getLegalActions(playerId: string): TAction[] {
        return this.rules.getLegalActions(this.state, playerId);
    }
}