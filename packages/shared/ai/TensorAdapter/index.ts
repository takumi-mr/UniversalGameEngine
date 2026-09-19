// packages/shared/ai/TensorAdapter/index.ts
// 組み込みの IAITensorAdapter を aiTensorRegistry に登録する。
// gRPC の Reset/Step（強化学習ループ）を使うゲームはここに追加する。
import { aiTensorRegistry } from "@engine/shared/ai/AITensorAdapterRegistry";
import { ChessTensorAdapter } from "@engine/shared/ai/TensorAdapter/ChessTensorAdapter";
import { GoTensorAdapter } from "@engine/shared/ai/TensorAdapter/GoTensorAdapter";
import { OthelloTensorAdapter } from "@engine/shared/ai/TensorAdapter/OthelloTensorAdapter";
import { ShogiTensorAdapter } from "@engine/shared/ai/TensorAdapter/ShogiTensorAdapter";

let registered = false;

export function registerBuiltinTensorAdapters(): void {
  if (registered) return;
  registered = true;
  aiTensorRegistry.register("othello", OthelloTensorAdapter);
  // shogi_3d はルールセットが shogi と同じ（見た目だけ 3D）なので同じアダプタを使う
  aiTensorRegistry.register("shogi", ShogiTensorAdapter);
  aiTensorRegistry.register("shogi_3d", ShogiTensorAdapter);
  // chess_3d も同様
  aiTensorRegistry.register("chess", ChessTensorAdapter);
  aiTensorRegistry.register("chess_3d", ChessTensorAdapter);
  aiTensorRegistry.register("go", GoTensorAdapter);
}

// import するだけで登録されるようにしておく
registerBuiltinTensorAdapters();

export { ChessTensorAdapter, GoTensorAdapter, OthelloTensorAdapter, ShogiTensorAdapter };
