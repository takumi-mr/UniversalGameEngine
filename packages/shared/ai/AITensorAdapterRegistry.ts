// packages/shared/ai/AITensorAdapterRegistry.ts
import { BaseGameState, BaseGameAction } from "../GameRules";
import type { IAITensorAdapter } from "./IAITensorAdapter";
import { OthelloTensorAdapter } from "./TensorAdapter/OthelloTensorAdapter";

class AITensorAdapterRegistry {
  // 任意のゲームタイプ文字列に対して、アダプターを保持する
  private adapters = new Map<string, IAITensorAdapter<any, any>>();

  constructor() {
    // ここで既知のゲームタイプに対するアダプターを登録しておく
    // 例: Othello
    this.register("othello", new OthelloTensorAdapter());
  }

  public register<TState extends BaseGameState, TAction extends BaseGameAction>(
    gameType: string,
    adapter: IAITensorAdapter<TState, TAction>,
  ): void {
    this.adapters.set(gameType.toLowerCase(), adapter);
  }

  public getAdapter<TState extends BaseGameState, TAction extends BaseGameAction>(
    gameType: string,
  ): IAITensorAdapter<TState, TAction> | undefined {
    return this.adapters.get(gameType.toLowerCase()) as
      | IAITensorAdapter<TState, TAction>
      | undefined;
  }
}

// シングルトンとしてエクスポート
export const aiTensorRegistry = new AITensorAdapterRegistry();
