// packages/shared/ai/AITensorAdapterRegistry.ts
import type { BaseGameState, BaseGameAction } from "../GameRules";
import type { IAITensorAdapter } from "./IAITensorAdapter";

class AITensorAdapterRegistry {
  // 任意のゲームタイプ文字列に対して、アダプターを保持する
  // （ゲームごとに State/Action 型が異なるため、格納時は型を消去する）
  private adapters = new Map<string, IAITensorAdapter<any, any>>();

  public register<TState extends BaseGameState, TAction extends BaseGameAction>(
    gameType: string,
    adapter: IAITensorAdapter<TState, TAction>,
  ): void {
    this.adapters.set(gameType.toLowerCase(), adapter);
  }

  public getAdapter(gameType: string): IAITensorAdapter<any, any> | undefined {
    return this.adapters.get(gameType.toLowerCase());
  }
}

// シングルトンとしてエクスポート
export const aiTensorRegistry = new AITensorAdapterRegistry();
