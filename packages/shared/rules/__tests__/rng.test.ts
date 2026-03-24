import { describe, it, expect } from "bun:test";
import { gameRegistry } from "../../GameRegistry";
import { UniversalEngine } from "../../UniversalEngine";

describe("RNG Determinism", () => {
  const games = gameRegistry.getAllDefinitions();

  for (const gameDef of games) {
    it(`should reproduce same random results: ${gameDef.name}`, () => {
      const def = gameRegistry.getDefinition(gameDef.type)!;
      const { ruleset } = def;

      const options = {
        clientSeed: "client_determinism_test",
        serverSeed: "server_determinism_test",
      };

      const e1 = new UniversalEngine(ruleset, options);
      const e2 = new UniversalEngine(ruleset, options);

      // 初期状態が一致しているか
      expect(JSON.stringify(e1.getState())).toBe(JSON.stringify(e2.getState()));

      for (let i = 0; i < 20; i++) {
        const s1 = e1.getState();
        const p1 = s1.activePlayers?.[0];
        if (!p1) break;

        const actions = e1.getLegalActions(p1);
        if (!actions.length) break;

        // 同じアクションを両方に適用
        const action = actions[0];

        e1.dispatch(action);
        e2.dispatch(action);

        const st1 = e1.getState();
        const st2 = e2.getState();

        if (JSON.stringify(st1) !== JSON.stringify(st2)) {
          console.error(`Divergence in ${gameDef.name} at step ${i}`);
          console.error("Engine 1 state hash:", st1.hash);
          console.error("Engine 2 state hash:", st2.hash);
          throw new Error(`RNG divergence detected in ${gameDef.name} at step ${i}`);
        }

        if (st1.status === "FINISHED") break;
      }
    });
  }
});
