import { describe, it, expect } from "vitest";
import { gameRegistry } from "@engine/shared/GameRegistry";
import { availableGames } from "./games";

// フロントのゲーム一覧と shared の GameRegistry がずれていないことを保証する。
// （一覧にあるのに登録されていないゲームは、ルーム作成時にサーバーで失敗する）
describe("availableGames", () => {
  it("type が重複していない", () => {
    const types = availableGames.map((g) => g.type);
    expect(new Set(types).size).toBe(types.length);
  });

  it.each(availableGames.map((g) => [g.type] as const))(
    "%s は GameRegistry に登録されている",
    (type) => {
      expect(gameRegistry.getDefinition(type)).toBeDefined();
    },
  );

  it("minPlayers <= maxPlayers", () => {
    for (const g of availableGames) {
      expect(g.minPlayers).toBeLessThanOrEqual(g.maxPlayers);
    }
  });
});
