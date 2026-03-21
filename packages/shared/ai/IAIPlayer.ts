// packages/shared/ai/IAIPlayer.ts
import type { BaseGameState, BaseGameAction } from '../GameRules';

/**
 * すべてのAI・探索ソルバーが実装すべき共通インターフェース
 */
export interface IAIPlayer<TState extends BaseGameState, TAction extends BaseGameAction> {
    /**
     * AIの識別名（ログ出力やUI表示用）
     */
    readonly name: string;

    /**
     * AI自身のプレイヤーID（エンジン上でのID）
     */
    readonly playerId: string;

    /**
     * 現在の状態と合法手のリストを受け取り、次に実行するアクションを決定する。
     * 探索（MCTSやMiniMaxなど）で時間がかかることを想定し、非同期(Promise)とする。
     * @param state 現在のゲーム状態（可能ならAI視点でマスクされた状態）
     * @param legalActions 現在のAIが実行可能なアクションの完全なリスト
     * @returns 決定したアクション。打てる手がない場合は null。
     */
    computeNextMove(
        state: TState,
        legalActions: TAction[],
        options?: {
            timeLimitMs?: number
            iterationLimit?: number
        }
    ): Promise<TAction | null>;

    observeAction?(action: TAction, newState: TState): void

    notifyGameEnd?(result: {
        winner?: string
        reason?: string
    }): void

    reset?(): void

    getDiagnostics?(): Record<string, AIDiagnosticValue>

    evaluateState?(state: TState): Promise<{
        value: number
        policy: Map<string, number>
    }>
}

/**
 * 診断情報の値に使用できる型（再帰的定義）
 */
export type AIDiagnosticValue =
    | string
    | number
    | boolean
    | null
    | undefined
    | { [key: string]: AIDiagnosticValue }
    | AIDiagnosticValue[];