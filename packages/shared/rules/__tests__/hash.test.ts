import { describe, it, expect } from "bun:test";
import { gameRegistry } from "../../GameRegistry";
import { UniversalEngine } from "../../UniversalEngine";
import { calculateStateHash } from "../../utils/hash";

describe("State Hash Consistency", () => {
  const games = gameRegistry.getAllDefinitions();

  for (const gameDef of games) {
    it(`should produce stable hash: ${gameDef.name}`, () => {
      const def = gameRegistry.getDefinition(gameDef.type)!;
      const { ruleset } = def;

      const engine = new UniversalEngine(ruleset, {
        clientSeed: "seed",
        serverSeed: "seed",
      });

      const state1 = engine.getState();
      const state2 = structuredClone(state1);

      const h1 = calculateStateHash(state1);
      const h2 = calculateStateHash(state2);

      expect(h1).toBeDefined();
      expect(h1).toBe(h2);

      // 一度計算したあとも、プロパティの順序などに関わらず安定しているか
      const h3 = calculateStateHash(state1);
      expect(h3).toBe(h1);
    });

    it(`should produce same hash for replayed actions: ${gameDef.name}`, () => {
      const def = gameRegistry.getDefinition(gameDef.type)!;
      const { ruleset } = def;

      const options = {
        clientSeed: "replay",
        serverSeed: "replay",
      };

      const e1 = new UniversalEngine(ruleset, options);
      const e2 = new UniversalEngine(ruleset, options);

      for (let i = 0; i < 5; i++) {
        const p1 = e1.getState().activePlayers?.[0];
        if (!p1) break;

        const actions = e1.getLegalActions(p1);
        if (actions.length === 0) break;

        const action = actions[0];
        e1.dispatch(action);
        e2.dispatch(action);

        const h1 = calculateStateHash(e1.getState());
        const h2 = calculateStateHash(e2.getState());

        expect(h1).toBe(h2);
      }
    });
  }
});
