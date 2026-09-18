// packages/shared/utils/requireRng.ts
import type { IGameRNG } from "@engine/shared/utils/IGameRNG";

/**
 * ルールセット内で乱数が必要な箇所に使う。
 * UniversalEngine は常に RNG を渡すので、undefined になるのはエンジンを介さずに
 * ルールセットを直接呼んだ場合だけ。その場合は黙って Math.random に落ちず、明示的に失敗させる
 * （決定論・リプレイの保証を破らないため）。
 */
export function requireRng(rng: IGameRNG | undefined, context = "ruleset"): IGameRNG {
  if (!rng) {
    throw new Error(
      `[${context}] IGameRNG is required for this operation. ` +
        "Use UniversalEngine (which always supplies an RNG) or pass an rng explicitly.",
    );
  }
  return rng;
}
