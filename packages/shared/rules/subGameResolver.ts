// packages/shared/rules/subGameResolver.ts
//
// サブゲーム（入れ子のルールセット）を type 名から解決する窓口。
// GameRegistry は各ルールセットを import するので、ルールセット側から GameRegistry を直接 import すると
// 循環になる。GameRegistry が起動時にここへリゾルバを登録し、メタ系ルールセットはこれだけに依存する。
import type { BaseGameAction, BaseGameState, GameRuleset } from "@engine/shared/GameRules";

export interface SubGameDefinition {
  type: string;
  name: string;
  ruleset: GameRuleset<any, any>;
  minPlayers: number;
  maxPlayers: number;
}

type Resolver = (type: string) => SubGameDefinition | undefined;

let resolver: Resolver | null = null;

export function setSubGameResolver(fn: Resolver): void {
  resolver = fn;
}

export function resolveSubGame(type: string): SubGameDefinition | undefined {
  if (!resolver) {
    throw new Error(
      "Sub-game resolver is not set. Import GameRegistry (or call setSubGameResolver) first.",
    );
  }
  return resolver(type);
}

export type AnyRuleset = GameRuleset<BaseGameState, BaseGameAction>;
