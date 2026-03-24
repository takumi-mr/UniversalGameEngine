// packages/shared/testing/assertDeterministicFull.ts

import { UniversalEngine } from "../UniversalEngine";
import type { GameRuleset, BaseGameState, BaseGameAction } from "../GameRules";
import { createHash } from "crypto";

/* ---------------- Utils ---------------- */

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

function hashState(state: unknown): string {
  return createHash("sha256").update(stableStringify(state)).digest("hex");
}

function deepEqual(a: unknown, b: unknown): boolean {
  return stableStringify(a) === stableStringify(b);
}

/**
 * legalActions を deterministic にするためソート
 */
function sortActions<T>(actions: T[]): T[] {
  return [...actions].sort((a, b) => stableStringify(a).localeCompare(stableStringify(b)));
}

/* ---------------- Main ---------------- */

interface Config<TState extends BaseGameState, TAction extends BaseGameAction, TOptions> {
  rules: GameRuleset<TState, TAction, TOptions>;
  options: TOptions;
  playerIds: string[];
  maxSteps?: number;
}

export function assertDeterministic<
  TState extends BaseGameState,
  TAction extends BaseGameAction,
  TOptions = any,
>(config: Config<TState, TAction, TOptions>) {
  const { rules, options, playerIds, maxSteps = 50 } = config;

  const e1 = new UniversalEngine(rules, options);
  const e2 = new UniversalEngine(rules, options);

  for (let step = 0; step < maxSteps; step++) {
    const s1 = e1.getState();
    const s2 = e2.getState();

    /* ---------------- State equality ---------------- */

    if (!deepEqual(s1, s2)) {
      throw new Error(`State mismatch at step ${step}`);
    }

    /* ---------------- Hash equality ---------------- */

    const h1 = hashState(s1);
    const h2 = hashState(s2);

    if (h1 !== h2) {
      throw new Error(`Hash mismatch at step ${step}`);
    }

    /* ---------------- Masked state ---------------- */

    for (const pid of playerIds) {
      const m1 = e1.getMaskedState(pid);
      const m2 = e2.getMaskedState(pid);

      if (!deepEqual(m1, m2)) {
        throw new Error(`Masked state mismatch at step ${step} for player ${pid}`);
      }
    }

    /* ---------------- 終了判定 ---------------- */

    if (s1.status === "FINISHED") break;

    /* ---------------- Legal Actions ---------------- */

    const activePlayers = s1.activePlayers?.length ? s1.activePlayers : playerIds;

    let legal: TAction[] = [];

    for (const pid of activePlayers) {
      const la1 = sortActions(e1.getLegalActions(pid));
      const la2 = sortActions(e2.getLegalActions(pid));

      if (!deepEqual(la1, la2)) {
        throw new Error(`Legal actions mismatch at step ${step}`);
      }

      if (la1.length > 0) {
        legal = la1;
        break;
      }
    }

    if (legal.length === 0) break;

    const action = legal[0];

    /* ---------------- Pure reduce check ---------------- */

    const next1a = rules.reduce(s1, action);
    const next1b = rules.reduce(s1, action);

    if (!deepEqual(next1a, next1b)) {
      throw new Error(`Reduce is not pure at step ${step}`);
    }

    /* ---------------- Dispatch ---------------- */

    const ok1 = e1.dispatch(action);
    const ok2 = e2.dispatch(action);

    if (ok1 !== ok2) {
      throw new Error(`Dispatch mismatch at step ${step}`);
    }
  }
}
