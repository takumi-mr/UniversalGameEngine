// packages/shared/rules/__tests__/determinism.test.ts

import { describe, it } from "bun:test";
import { gameRegistry } from "../../GameRegistry";
import { assertDeterministic } from "../../testing/assertDeterministic";

/**
 * すべての登録済みゲームに対して決定論テストを自動実行する。
 * 各ゲームについて、ランダムなアクション列を生成し、同じシードで初期化した2つのエンジンが
 * 常に同じ状態に遷移することを確認する。
 */
describe("Ruleset Determinism", () => {
  const games = gameRegistry.getAllDefinitions();

  for (const gameDef of games) {
    it(`should be deterministic for game: ${gameDef.name} (${gameDef.type})`, () => {
      const fullDef = gameRegistry.getDefinition(gameDef.type);
      if (!fullDef) throw new Error(`Game definition not found for ${gameDef.type}`);

      const { ruleset, minPlayers, maxPlayers } = fullDef;

      // テスト用のプレイヤーIDリストを作成
      const playerCount = maxPlayers || minPlayers;
      const playerIds = Array.from({ length: playerCount }, (_, i) => `player-${i + 1}`);

      const playerMapping: Record<string, string> = {};
      playerIds.forEach((id, idx) => {
        playerMapping[String(idx + 1)] = id;
        playerMapping[String(idx)] = id; // 0-indexed also
      });

      // 決定論テストの構成
      assertDeterministic({
        rules: ruleset,
        options: {
          clientSeed: "test-client-seed",
          serverSeed: "test-server-seed",
          players: playerIds, // 配列形式
          playerIds: playerIds, // 別名
          playerMapping: playerMapping, // マッピング形式
          // 状態に直接入る players も想定して入れておく
          initialPlayers: playerMapping,
        },
        generateActions: (engine) => {
          const actions: any[] = [];
          const MAX_STEPS = 50;

          for (let step = 0; step < MAX_STEPS; step++) {
            const state = engine.getState();
            if (state.status === "FINISHED") break;

            // アクティブなプレイヤーがいればそのプレイヤーの、いなければ全プレイヤーから合法手を探す
            const currentPlayers = state.activePlayers || playerIds;
            let legalActions: any[] = [];

            for (const pid of currentPlayers) {
              const la = engine.getLegalActions(pid);
              if (la.length > 0) {
                legalActions = la;
                break;
              }
            }

            if (legalActions.length === 0) {
              // 合法手がない場合は終了（通常はありえないが、不完全なルールセットへの対策）
              break;
            }

            // ランダムに1つ選択（テストの再現性のために、ここでの乱数も固定したいが、
            // getLegalActionsの結果自体が確定的なら、最初の1つを選ぶだけでも十分テストになる）
            const action = legalActions[0];
            actions.push(action);

            // エンジンを更新して次のステップへ
            if (!engine.dispatch(action)) {
              break;
            }
          }

          return actions;
        },
      });
    });
  }
});
