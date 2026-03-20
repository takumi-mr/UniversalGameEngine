// packages/shared/ai/IAITensorAdapter.ts
import type { BaseGameState, BaseGameAction } from '../GameRules';

export interface IAITensorAdapter<TState extends BaseGameState, TAction extends BaseGameAction> {
    /**
     * 現在のゲーム状態を、特定のプレイヤーの視点から数値配列（テンソル）に変換する
     * ※「自分のコマは常に正の値、相手は負の値」のように視点を固定するために playerId が必要
     */
    encodeState: (state: TState, playerId: string) => number[];

    /**
     * 現在の合法手を、AIが出力する数値インデックス（0 ~ N）の配列に変換する
     */
    encodeLegalActions: (state: TState, playerId: string) => number[];

    /**
     * AIが出力したインデックス番号を、実際のゲームアクションに復元する
     */
    decodeAction: (state: TState, actionId: number, playerId: string) => TAction;
}