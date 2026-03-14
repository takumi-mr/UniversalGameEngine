// packages/shared/ai/RandomPlayer.ts
import type { BaseGameState, BaseGameAction } from '../UniversalEngine';
import type { IAIPlayer } from './IAIPlayer';

export class RandomPlayer<TState extends BaseGameState, TAction extends BaseGameAction>
    implements IAIPlayer<TState, TAction> {

    public readonly name: string;
    public readonly playerId: string;

    // 思考している感を出すための意図的なディレイ（ミリ秒）
    private thinkDelayMs: number;

    constructor(playerId: string, name: string = "RandomBot", thinkDelayMs: number = 500) {
        this.playerId = playerId;
        this.name = name;
        this.thinkDelayMs = thinkDelayMs;
    }

    public async computeNextMove(state: TState, legalActions: TAction[]): Promise<TAction | null> {
        // 1. 合法手が無い場合は何もしない
        if (!legalActions || legalActions.length === 0) {
            return null;
        }

        // 2. 人間らしさ（またはUIの非同期処理のテスト）のためのディレイ
        if (this.thinkDelayMs > 0) {
            await new Promise(resolve => setTimeout(resolve, this.thinkDelayMs));
        }

        // 3. ランダムに1つ手を選ぶ
        const randomIndex = Math.floor(Math.random() * legalActions.length);
        const selectedAction = legalActions[randomIndex];

        // 念のため、AIのplayerIdをアクションに付与して返す
        return {
            ...selectedAction,
            playerId: this.playerId
        };
    }
}