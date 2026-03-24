import { describe, it } from "bun:test";
import { gameRegistry } from "../../GameRegistry";
import { UniversalEngine } from "../../UniversalEngine";
import { deepFreeze } from "../../utils/freeze";

describe("Ruleset Immutability", () => {
  const games = gameRegistry.getAllDefinitions();

  for (const gameDef of games) {
    it(`should not mutate state in reduce: ${gameDef.name}`, () => {
      const def = gameRegistry.getDefinition(gameDef.type)!;
      const { ruleset } = def;

      const engine = new UniversalEngine(ruleset, {
        clientSeed: "test",
        serverSeed: "test",
      });

      // 複数ステップ実行して、各ステップで元状態が壊れていないか確認
      for (let i = 0; i < 10; i++) {
        const stateBefore = engine.getState();
        // 開発環境のUniversalEngine.dispatchは内部で既にdeepFreezeしているはずだが
        // テストでも明示的に現在の状態をフリーズして、共有参照による破壊が起きないか確認する
        deepFreeze(stateBefore);

        const snapshot = structuredClone(stateBefore);

        const activePlayers = stateBefore.activePlayers || [];
        const players =
          activePlayers.length > 0
            ? activePlayers
            : (Object.values(stateBefore.players || {}).filter((p) => p !== null) as string[]);

        if (!players.length) break;

        const actions = engine.getLegalActions(players[0]);
        if (actions.length === 0) break;

        const action = actions[0];

        // もし内部で直接 stateBefore (またはその一部) を書き換えていたら、
        // deepFreeze しているので TypeError が発生するか、
        // JSON.stringify の比較で不一致になる
        try {
          engine.dispatch(action);
        } catch (e) {
          console.error(`Error in game ${gameDef.name} at step ${i}:`, e);
          throw new Error(`State mutation detected via freeze error: ${e}`, { cause: e });
        }

        // 元stateが変わってたらNG
        if (JSON.stringify(stateBefore) !== JSON.stringify(snapshot)) {
          throw new Error(`State was mutated by reduce() in ${gameDef.name} at step ${i}`);
        }

        if (engine.getState().status === "FINISHED") break;
      }
    });
  }
});
