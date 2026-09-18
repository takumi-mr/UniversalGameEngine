// packages/shared/ai/AITensorAdapterRegistry.ts
import type { BaseGameState, BaseGameAction } from "@engine/shared/GameRules";
import type { IAITensorAdapter } from "@engine/shared/ai/IAITensorAdapter";

class AITensorAdapterRegistry {
  // 任意のゲームタイプ文字列に対して、アダプターを保持する
  // （ゲームごとに State/Action 型が異なるため、格納時は型を消去する）
  private adapters = new Map<string, IAITensorAdapter<BaseGameState, BaseGameAction>>();

  public register<TState extends BaseGameState, TAction extends BaseGameAction>(
    gameType: string,
    adapter: IAITensorAdapter<TState, TAction>,
  ): void {
    this.adapters.set(
      gameType.toLowerCase(),
      adapter as unknown as IAITensorAdapter<BaseGameState, BaseGameAction>,
    );
  }

  public getAdapter<TState extends BaseGameState, TAction extends BaseGameAction>(
    gameType: string,
  ): IAITensorAdapter<TState, TAction> | undefined {
    return this.adapters.get(gameType.toLowerCase()) as unknown as
      | IAITensorAdapter<TState, TAction>
      | undefined;
  }
}

// シングルトンとしてエクスポート
// 組み込みアダプタの登録は ./TensorAdapter/index.ts で行う
export const aiTensorRegistry = new AITensorAdapterRegistry();
