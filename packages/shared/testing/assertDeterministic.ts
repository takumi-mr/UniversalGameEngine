// packages/shared/testing/assertDeterministic.ts

import { UniversalEngine } from "../UniversalEngine";
import type { GameRuleset, BaseGameState, BaseGameAction } from "../GameRules";
import { createHash } from "crypto";

/**
 * 安定JSON stringify（キーソート）
 * 状態オブジェクトの差分を正確に比較するために必要
 */
function stableStringify(obj: unknown): string {
  if (obj === null || typeof obj !== "object") {
    return JSON.stringify(obj);
  }

  if (Array.isArray(obj)) {
    return `[${obj.map(stableStringify).join(",")}]`;
  }

  const keys = Object.keys(obj as Record<string, unknown>).sort();
  return `{${keys.map((k) => `"${k}":${stableStringify((obj as any)[k])}`).join(",")}}`;
}

/**
 * 状態のハッシュ値を計算する
 */
function hashState(state: unknown): string {
  return createHash("sha256").update(stableStringify(state)).digest("hex");
}

/**
 * deepEqual（簡易）
 */
function deepEqual(a: unknown, b: unknown): boolean {
  return stableStringify(a) === stableStringify(b);
}

export interface DeterminismTestOptions<
  TState extends BaseGameState,
  TAction extends BaseGameAction,
  TOptions,
> {
  rules: GameRuleset<TState, TAction, TOptions>;
  options: TOptions;

  /**
   * テストに使うアクション列を返す
   * engineを受け取るので、その場で合法手から生成してもOK
   */
  generateActions: (engine: UniversalEngine<TState, TAction, TOptions>) => TAction[];

  /**
   * ステップごとのhashチェックをするか
   */
  checkStepHash?: boolean;
}

/**
 * 任意のGameRulesetに対して決定論テストを実行
 * 2つのエンジンを同じシード（options内）で初期化し、同じアクション列を適用した際、
 * 全てのステップで状態が完全に一致することを検証する。
 */
export function assertDeterministic<
  TState extends BaseGameState,
  TAction extends BaseGameAction,
  TOptions = any,
>(config: DeterminismTestOptions<TState, TAction, TOptions>) {
  const { rules, options, generateActions, checkStepHash = true } = config;

  // --- アクションの生成 ---
  // 別のアセットエンジンを使ってアクション列を生成する
  const eGen = new UniversalEngine(rules, options);
  const actions = generateActions(eGen);

  // --- 2つのエンジンを同条件で生成 ---
  const e1 = new UniversalEngine(rules, options);
  const e2 = new UniversalEngine(rules, options);

  const hashes1: string[] = [];
  const hashes2: string[] = [];

  for (let i = 0; i < actions.length; i++) {
    const action = actions[i];

    const ok1 = e1.dispatch(action);
    const ok2 = e2.dispatch(action);

    if (ok1 !== ok2) {
      throw new Error(
        `Dispatch result mismatch at step ${i} (action: ${action.type}): e1=${ok1}, e2=${ok2}`,
      );
    }

    const s1 = e1.getState();
    const s2 = e2.getState();

    if (!deepEqual(s1, s2)) {
      // どこが違うかデバッグしやすくするために一部表示
      console.error("State mismatch detail:");
      console.error("e1 state:", JSON.stringify(s1, null, 2));
      console.error("e2 state:", JSON.stringify(s2, null, 2));
      throw new Error(`State mismatch at step ${i} (action: ${action.type})`);
    }

    if (checkStepHash) {
      const h1 = hashState(s1);
      const h2 = hashState(s2);

      hashes1.push(h1);
      hashes2.push(h2);

      if (h1 !== h2) {
        throw new Error(`Hash mismatch at step ${i} (action: ${action.type})`);
      }
    }
  }

  return {
    finalState: e1.getState(),
    hashes: hashes1,
  };
}
