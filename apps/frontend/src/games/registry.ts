import { defineAsyncComponent, type Component } from "vue";
import { gameRegistry } from "@engine/shared/GameRegistry";
import type { GameCategory, GameUIDefinition } from "@/games/types";

// `src/games/<type>/index.ts` を自動収集する。ゲーム追加時にこのファイルを触る必要はない。
const modules = import.meta.glob<{ default: GameUIDefinition }>("./*/index.ts", { eager: true });

/** type → フロント定義 */
export const gameUiRegistry: Readonly<Record<string, GameUIDefinition>> = Object.fromEntries(
  Object.values(modules).map((m) => [m.default.type, m.default]),
);

/** ゲーム選択画面・ルーム画面が使う一覧エントリ（shared のメタ情報 + フロント定義の合成） */
export interface GameCatalogEntry {
  type: string;
  name: string;
  description: string;
  emoji: string;
  minPlayers: number;
  maxPlayers: number;
  rules?: string;
  category: GameCategory;
}

/**
 * フロントに画面定義があり、かつ shared の GameRegistry にも登録されているゲームの一覧。
 * 片方にしかないものは出さない（ルーム作成時にサーバーで失敗するため）。
 */
export const gameCatalog: readonly GameCatalogEntry[] = Object.values(gameUiRegistry).flatMap(
  (ui) => {
    const def = gameRegistry.getDefinition(ui.type);
    if (!def) return [];
    return [
      {
        type: def.type,
        name: def.name,
        description: def.description,
        emoji: def.emoji,
        minPlayers: def.minPlayers,
        maxPlayers: def.maxPlayers,
        rules: def.rules,
        category: ui.category,
      },
    ];
  },
);

export function getGameCatalogEntry(type: string): GameCatalogEntry | undefined {
  return gameCatalog.find((g) => g.type === type);
}

// defineAsyncComponent は呼ぶたびに別コンポーネントになるので、type ごとにキャッシュする
const componentCache = new Map<string, Component>();

/** 対局画面用の盤面コンポーネント。定義がなければ null（Raw State 表示にフォールバック） */
export function getGameComponent(type: string): Component | null {
  const loader = gameUiRegistry[type]?.component;
  if (!loader) return null;
  let c = componentCache.get(type);
  if (!c) {
    c = defineAsyncComponent(loader);
    componentCache.set(type, c);
  }
  return c;
}

/** リプレイ画面用の盤面コンポーネント。replay: false のゲームは null */
export function getReplayComponent(type: string): Component | null {
  const ui = gameUiRegistry[type];
  if (!ui || ui.replay === false) return null;
  return getGameComponent(type);
}
