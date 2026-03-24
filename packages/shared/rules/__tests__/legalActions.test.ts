import { describe, it } from "bun:test";
import { gameRegistry } from "../../GameRegistry";
import { UniversalEngine } from "../../UniversalEngine";

describe("Legal Actions Validity", () => {
  const games = gameRegistry.getAllDefinitions();

  for (const gameDef of games) {
    it(`all legal actions must be valid according to isValidAction: ${gameDef.name}`, () => {
      const def = gameRegistry.getDefinition(gameDef.type)!;
      const { ruleset } = def;

      const engine = new UniversalEngine(ruleset, {
        clientSeed: "validity_test",
        serverSeed: "validity_test",
      });

      // 数ステップ実行して確認
      for (let i = 0; i < 10; i++) {
        const state = engine.getState();
        const activePlayers = state.activePlayers || [];

        // 全員分の合法手を確認
        const playersToCheck =
          activePlayers.length > 0
            ? activePlayers
            : (Object.values(state.players || {}).filter((p) => p !== null) as string[]);

        for (const p of playersToCheck) {
          const actions = engine.getLegalActions(p);

          for (const action of actions) {
            const isValid = ruleset.isValidAction(state, action);
            if (!isValid) {
              console.error(
                `Invalid action returned by getLegalActions for ${gameDef.name}:`,
                action,
              );
              throw new Error(
                `Illegal action returned in getLegalActions for ${gameDef.name} at step ${i}`,
              );
            }
          }
        }

        // 次のステップへ（適当なアクションを1つ選んで進める）
        const firstPlayerActions =
          activePlayers.length > 0 ? engine.getLegalActions(activePlayers[0]) : [];
        if (firstPlayerActions.length > 0) {
          engine.dispatch(firstPlayerActions[0]);
        } else {
          break;
        }

        if (engine.getState().status === "FINISHED") break;
      }
    });
  }
});
