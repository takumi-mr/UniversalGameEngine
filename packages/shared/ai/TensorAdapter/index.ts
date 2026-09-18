// packages/shared/ai/TensorAdapter/index.ts
// 組み込みの IAITensorAdapter を aiTensorRegistry に登録する。
// gRPC の Reset/Step（強化学習ループ）を使うゲームはここに追加する。
import { aiTensorRegistry } from "@engine/shared/ai/AITensorAdapterRegistry";
import { OthelloTensorAdapter } from "@engine/shared/ai/TensorAdapter/OthelloTensorAdapter";

let registered = false;

export function registerBuiltinTensorAdapters(): void {
  if (registered) return;
  registered = true;
  aiTensorRegistry.register("othello", OthelloTensorAdapter);
}

// import するだけで登録されるようにしておく
registerBuiltinTensorAdapters();

export { OthelloTensorAdapter };
