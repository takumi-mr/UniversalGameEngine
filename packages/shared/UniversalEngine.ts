// packages/shared/UniversalEngine.ts
// --- 1. エンジンが要求する「ルールの文法（契約）」 ---
export interface GameRuleset<TState, TAction> {
    // 1. ゲームの初期状態を生成する関数
    getInitialState: (options?: any) => TState;
    
    // 2. そのアクションが現在の状態で「合法手」かどうかを判定する関数
    isValidAction: (state: TState, action: TAction) => boolean;
    
    // 3. アクションを受け取り、新しい状態を返す関数（Reducer）
    reduce: (state: TState, action: TAction) => TState;
    
    // 4. ゲームが終了したかどうか、誰が勝ったかを判定する関数
    checkWinCondition: (state: TState) => { isFinished: boolean; message?: string };
}

// --- 2. 汎用エンジン本体 ---
export class UniversalEngine<TState, TAction> {
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
            // エンジン側のステータスを終了にする等の処理
            console.log("Game Finished!", winCheck.message);
        }

        return true;
    }
}