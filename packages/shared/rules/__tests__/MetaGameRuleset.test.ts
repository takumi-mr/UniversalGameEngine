// packages/shared/rules/__tests__/MetaGameRuleset.test.ts
import { describe, it, expect } from "bun:test";
import "@engine/shared/GameRegistry"; // サブゲームのリゾルバを登録する
import { UniversalEngine } from "@engine/shared/UniversalEngine";
import {
  MetaGameRuleset,
  createSubGame,
  applySubGameAction,
  type MetaGameAction,
  type MetaGameState,
} from "@engine/shared/rules/MetaGameRuleset";
import type { TicTacToeAction } from "@engine/shared/rules/TicTacToeRuleset";
import { ProvablyFairRNG } from "@engine/shared/utils/ProvablyFairRNG";

// playerA: 0, 1, 2 (Win) / playerB: 3, 4
const winningMoves: TicTacToeAction[] = [
  { type: "PLACE", index: 0, playerId: "playerA" },
  { type: "PLACE", index: 3, playerId: "playerB" },
  { type: "PLACE", index: 1, playerId: "playerA" },
  { type: "PLACE", index: 4, playerId: "playerB" },
  { type: "PLACE", index: 2, playerId: "playerA" },
];

describe("MetaGameRuleset", () => {
  it("createSubGame は着席・開始まで済ませ、applySubGameAction は終局で result を返す", () => {
    let entry = createSubGame("tictactoe", ["playerA", "playerB"]);
    expect(entry.state.status).toBe("PLAYING");
    expect(entry.state.players).toEqual({ 1: "playerA", [-1]: "playerB" });
    expect(entry.state.activePlayers).toEqual(["playerA"]);

    for (const a of winningMoves) entry = applySubGameAction(entry, a);
    expect(entry.state.status).toBe("FINISHED");
    expect(entry.result?.winnerIds).toEqual(["playerA"]);

    // START を自前で扱うゲーム（HighLow）も開始状態になる
    const hl = createSubGame("high_low", ["x", "y"], new ProvablyFairRNG("s", "c", 0));
    expect(hl.state.status).toBe("PLAYING");
    expect(hl.state.activePlayers).toEqual(["x"]);
  });

  it("複数のサブゲームを管理し、結果を集約してメタゲームを終える（エンジン経由）", () => {
    const players = { "1": "playerA", "-1": "playerB" };
    const engine = new UniversalEngine<MetaGameState, MetaGameAction>(MetaGameRuleset, {
      clientSeed: "meta",
      serverSeed: "meta",
      players,
      initialSubGames: [
        { id: "game1", type: "tictactoe" },
        { id: "game2", type: "tictactoe" },
      ],
    });
    let state = engine.getState();
    expect(Object.keys(state.subGames)).toHaveLength(2);
    expect(state.activePlayers).toEqual(["playerA"]);

    // 手番でない人・不正な手は弾かれる
    expect(
      engine.dispatch({
        type: "SUBGAME_ACTION",
        playerId: "playerB",
        subGameId: "game1",
        subAction: { type: "PLACE", index: 0 } as TicTacToeAction,
      }),
    ).toBe(false);

    const play = (subGameId: string) => {
      for (const subAction of winningMoves) {
        expect(
          engine.dispatch({
            type: "SUBGAME_ACTION",
            playerId: subAction.playerId!,
            subGameId,
            subAction,
          }),
        ).toBe(true);
      }
    };
    play("game1");
    state = engine.getState();
    expect(state.subGames.game1.state.status).toBe("FINISHED");
    expect(state.metaScores.playerA).toBe(1);
    expect(state.subGames.game2.state.status).toBe("PLAYING");
    expect(state.message).toContain("Sub-game game1 finished.");
    // 終わった盤の手は合法手に出てこない
    expect(engine.getLegalActions("playerA").every((a) => a.subGameId === "game2")).toBe(true);

    play("game2");
    state = engine.getState();
    expect(state.metaScores.playerA).toBe(2);
    expect(state.status).toBe("FINISHED");
    expect(MetaGameRuleset.checkWinCondition(state).winnerIds).toEqual(["playerA"]);
  });
});
