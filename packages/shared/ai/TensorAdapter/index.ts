// packages/shared/ai/TensorAdapter/index.ts
// 組み込みの IAITensorAdapter を aiTensorRegistry に登録する。
// gRPC の Reset/Step（強化学習ループ）を使うゲームはここに追加する。
import { aiTensorRegistry } from "../AITensorAdapterRegistry";
import { OthelloTensorAdapter } from "./OthelloTensorAdapter";

let registered = false;

export function registerBuiltinTensorAdapters(): void {
  if (registered) return;
  registered = true;
  aiTensorRegistry.register("othello", OthelloTensorAdapter);
}

// import するだけで登録されるようにしておく
registerBuiltinTensorAdapters();

export { OthelloTensorAdapter };
