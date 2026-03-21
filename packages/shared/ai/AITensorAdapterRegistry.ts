// packages/shared/ai/AITensorAdapterRegistry.ts
import { BaseGameState, BaseGameAction } from "../GameRules";
import type { IAITensorAdapter } from "./IAITensorAdapter";

class AITensorAdapterRegistry<TState extends BaseGameState, TAction extends BaseGameAction> {
  // 任意のゲームタイプ文字列に対して、アダプターを保持する
  private adapters = new Map<string, IAITensorAdapter<TState, TAction>>();

  public register(gameType: string, adapter: IAITensorAdapter<TState, TAction>): void {
    this.adapters.set(gameType.toLowerCase(), adapter);
  }

  public getAdapter(gameType: string): IAITensorAdapter<any, any> | undefined {
    return this.adapters.get(gameType.toLowerCase());
  }
}

// シングルトンとしてエクスポート
export const aiTensorRegistry = new AITensorAdapterRegistry();
