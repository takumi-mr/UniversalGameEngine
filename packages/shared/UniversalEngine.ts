// packages/shared/UniversalEngine.ts
import { BaseGameState, BaseGameAction, GameRuleset, isSecret } from "./GameRules";

// --- 2. 汎用エンジン本体 ---
export class UniversalEngine<TState extends BaseGameState, TAction extends BaseGameAction> {
    private state: TState;
    private rules: GameRuleset<TState, TAction>;
    public history: TAction[] = [];

    constructor(rules: GameRuleset<TState, TAction>, options?: any) {
        this.rules = rules;
        this.state = this.rules.getInitialState(options);
        if (this.state.version === undefined) {
            this.state.version = 0;
        }
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
        // 1. Secret 型を用いた自動マスク処理
        let maskedState = this.autoMask(this.state, playerId);

        // 2. 既存のルールセット固有のマスク処理があれば適用 (互換性維持)
        if (this.rules.maskState) {
            maskedState = this.rules.maskState(maskedState, playerId);
        }
        return maskedState;
    }

    /**
     * オブジェクト内を再帰的に走査し、Secret型を見つけたら閲覧権限に応じてマスクする
     */
    private autoMask(obj: any, playerId: string): any {
        if (obj === null || typeof obj !== 'object') {
            return obj;
        }

        // Secret型の処理
        if (isSecret(obj)) {
            const isVisible = obj.visibleTo.includes('*') || obj.visibleTo.includes(playerId);
            if (isVisible) {
                // 閲覧権限がある場合は中身を展開（再帰的にさらにマスクが必要か確認）
                return this.autoMask(obj.value, playerId);
            } else {
                // 権限がない場合はマスク値（デフォルト "?"）を返す
                return obj.maskedValue !== undefined ? obj.maskedValue : '?';
            }
        }

        // 配列の処理
        if (Array.isArray(obj)) {
            return obj.map(item => this.autoMask(item, playerId));
        }

        // 通常のオブジェクトの処理
        const result: any = {};
        for (const [key, value] of Object.entries(obj)) {
            result[key] = this.autoMask(value, playerId);
        }
        return result;
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

        // 3.5 状態のバージョンをインクリメント
        this.state.version++;

        return true;
    }

    /**
     * 特定のプレイヤーが現在実行可能な合法手一覧を取得する機能（AIやUI補助用）
     */
    public getLegalActions(playerId: string): TAction[] {
        return this.rules.getLegalActions(this.state, playerId);
    }
}