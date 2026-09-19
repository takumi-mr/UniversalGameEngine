import { describe, it, expect } from "vitest";
import { gameRegistry } from "@engine/shared/GameRegistry";
import {
  gameCatalog,
  gameUiRegistry,
  getGameComponent,
  getReplayComponent,
} from "@/games/registry";

// src/games/<type>/index.ts の定義と shared の GameRegistry がずれていないことを保証する。
// （一覧にあるのに登録されていないゲームは、ルーム作成時にサーバーで失敗する）
describe("gameUiRegistry", () => {
  const types = Object.keys(gameUiRegistry);

  it("定義が 1 つ以上ある", () => {
    expect(types.length).toBeGreaterThan(0);
  });

  it.each(types.map((t) => [t] as const))("%s は GameRegistry に登録されている", (type) => {
    expect(gameRegistry.getDefinition(type)).toBeDefined();
  });
});

describe("gameCatalog", () => {
  it("UI 定義があるゲームだけを含み、メタ情報は GameRegistry 由来", () => {
    expect(gameCatalog.map((g) => g.type).sort()).toEqual(Object.keys(gameUiRegistry).sort());
    for (const g of gameCatalog) {
      const def = gameRegistry.getDefinition(g.type)!;
      expect(g.emoji).toBe(def.emoji);
      expect(g.minPlayers).toBe(def.minPlayers);
      expect(g.maxPlayers).toBe(def.maxPlayers);
      expect(g.minPlayers).toBeLessThanOrEqual(g.maxPlayers);
    }
  });
});

describe("getGameComponent / getReplayComponent", () => {
  it("同じ type には同じコンポーネントインスタンスを返す（再マウント防止）", () => {
    expect(getGameComponent("tictactoe")).toBe(getGameComponent("tictactoe"));
    expect(getReplayComponent("tictactoe")).toBe(getGameComponent("tictactoe"));
  });

  it("component 未定義のゲームは null（Raw State 表示にフォールバック）", () => {
    expect(getGameComponent("cave_dive")).toBeNull();
    expect(getGameComponent("unknown_game")).toBeNull();
  });

  it("replay: false のゲームはリプレイ用コンポーネントを返さない", () => {
    expect(getGameComponent("cyber_strike")).not.toBeNull();
    expect(getReplayComponent("cyber_strike")).toBeNull();
  });
});
