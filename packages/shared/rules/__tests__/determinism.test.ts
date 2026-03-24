// packages/shared/rules/__tests__/determinism.test.ts

import { describe, it } from "bun:test";
import { gameRegistry } from "../../GameRegistry";
import { assertDeterministic } from "../../testing/assertDeterministic";

const SEEDS = [
  { clientSeed: "seed-A", serverSeed: "server-A" },
  { clientSeed: "seed-B", serverSeed: "server-B" },
  { clientSeed: "seed-C", serverSeed: "server-C" },
];

describe("Ruleset Determinism (Full)", () => {
  const games = gameRegistry.getAllDefinitions();

  for (const gameDef of games) {
    for (const seed of SEEDS) {
      it(`deterministic: ${gameDef.name} (${gameDef.type}) [${seed.clientSeed}]`, () => {
        const fullDef = gameRegistry.getDefinition(gameDef.type);
        if (!fullDef) throw new Error(`Game definition not found for ${gameDef.type}`);

        const { ruleset, minPlayers, maxPlayers } = fullDef;

        const playerCount = maxPlayers || minPlayers;
        const playerIds = Array.from({ length: playerCount }, (_, i) => `player-${i + 1}`);

        assertDeterministic({
          rules: ruleset,
          options: {
            ...seed,
            players: playerIds,
            playerIds,
          },
          playerIds,
          maxSteps: 50,
        });
      });
    }
  }
});
