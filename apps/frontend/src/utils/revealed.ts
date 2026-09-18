// apps/frontend/src/utils/revealed.ts
import type { Secret } from "@engine/shared/GameRules";

/**
 * サーバーから届く状態は engine.getMaskedState() 済みで、Secret<T> はラッパーではなく
 * 中身 T（閲覧可のとき）か maskedValue（閲覧不可のとき。既定 "?"）に展開されている。
 * ルールセットの State 型は Secret<T> のままなので、コンポーネントではこれで実体の型に読み替える。
 *
 * 閲覧不可のときの値はルールセット側の maskedValue 次第（"?" や伏せ札の配列など）なので、
 * 呼び出し側で T として扱えるかどうかは、そのゲームの maskedValue を確認すること。
 */
export function revealed<T>(secret: Secret<T> | undefined | null): T | undefined {
  return secret as unknown as T | undefined;
}
