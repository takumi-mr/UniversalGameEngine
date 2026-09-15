// packages/shared/rules/__tests__/determinism.test.ts

import { describe, it, expect, spyOn } from "bun:test";
import { gameRegistry } from "../../GameRegistry";
import { UniversalEngine } from "../../UniversalEngine";
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

describe("Ruleset Determinism (no Math.random, seed auto-recording)", () => {
  const games = gameRegistry.getAllDefinitions();

  for (const gameDef of games) {
    it(`never calls Math.random: ${gameDef.name} (${gameDef.type})`, () => {
      const fullDef = gameRegistry.getDefinition(gameDef.type)!;
      const playerCount = fullDef.maxPlayers || fullDef.minPlayers;
      const playerIds = Array.from({ length: playerCount }, (_, i) => `player-${i + 1}`);

      // ルールセットが Math.random に落ちていたらここで例外になる
      const spy = spyOn(Math, "random").mockImplementation(() => {
        throw new Error(`${gameDef.type} called Math.random()`);
      });
      try {
        const engine = new UniversalEngine(fullDef.ruleset, {
          clientSeed: "c",
          serverSeed: "s",
          players: playerIds,
          playerIds,
        });
        for (const pid of playerIds) engine.dispatch({ type: "JOIN", playerId: pid } as any);
        engine.dispatch({ type: "START", playerId: playerIds[0] } as any);
        for (let step = 0; step < 40; step++) {
          const state = engine.getState();
          if (state.status === "FINISHED") break;
          const active = state.activePlayers?.length ? state.activePlayers : playerIds;
          let acted = false;
          for (const pid of active) {
            const legal = engine.getLegalActions(pid);
            if (legal.length > 0) {
              engine.dispatch(legal[step % legal.length]!);
              acted = true;
              break;
            }
          }
          if (!acted) break;
        }
      } finally {
        spy.mockRestore();
      }
    });
  }

  it("シード未指定で作ったエンジンは、状態に記録されたシードから同じ展開を再現できること", () => {
    const def = gameRegistry.getDefinition("texas_holdem") ?? gameRegistry.getDefinition("uno");
    if (!def) throw new Error("no random game registered");
    const playerIds = ["p1", "p2"];
    const e1 = new UniversalEngine(def.ruleset, { players: playerIds, playerIds });
    const s1 = e1.getState() as any;
    expect(s1.prngConfig?.clientSeed).toBeTruthy();
    expect(s1.prngSecret).toBeTruthy();

    // 同じシードで作り直すと初期状態（配札など）が一致する
    const e2 = new UniversalEngine(def.ruleset, {
      players: playerIds,
      playerIds,
      clientSeed: s1.prngConfig.clientSeed,
      serverSeed: s1.prngSecret,
    });
    expect(JSON.stringify(e2.getState())).toBe(JSON.stringify(s1));

    // 別のエンジンは別のシードになる（自動生成が固定値でないこと）
    const e3 = new UniversalEngine(def.ruleset, { players: playerIds, playerIds });
    expect((e3.getState() as any).prngConfig.clientSeed).not.toBe(s1.prngConfig.clientSeed);
  });
});
