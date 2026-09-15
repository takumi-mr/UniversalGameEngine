// packages/shared/testing/withTestRng.ts
import type { BaseGameAction, BaseGameState, GameRuleset } from "../GameRules";
import { MersenneTwisterRNG } from "../utils/MersenneTwisterRNG";

/**
 * テスト用: ルールセットを直接呼ぶときに rng を省略できるようにする。
 * （本番では UniversalEngine が常に rng を渡す。ルールセット側は requireRng で必須扱い）
 * 明示的に rng を渡した呼び出しはそのまま通す。
 */
export function withTestRng<
  TState extends BaseGameState,
  TAction extends BaseGameAction,
  TOptions = Record<string, unknown>,
>(
  rules: GameRuleset<TState, TAction, TOptions>,
  seed = 12345,
): GameRuleset<TState, TAction, TOptions> {
  const rng = new MersenneTwisterRNG(seed);
  return {
    ...rules,
    getInitialState: (options, r) => rules.getInitialState(options, r ?? rng),
    reduce: (state, action, r) => rules.reduce(state, action, r ?? rng),
  };
}
