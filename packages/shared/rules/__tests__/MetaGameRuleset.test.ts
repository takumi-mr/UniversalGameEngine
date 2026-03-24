// packages/shared/rules/__tests__/MetaGameRuleset.test.ts
import { describe, it, expect } from "bun:test";
import { MetaGameRuleset, MetaGameAction } from "../MetaGameRuleset";
import { TicTacToeRuleset, TicTacToeAction } from "../TicTacToeRuleset";

describe("MetaGameRuleset", () => {
  it("複数のサブゲーム（○×ゲーム）を管理し、その結果を集約できる", () => {
    // 1. メタゲームの初期化 (2つの○×ゲームを開始)
    const players = { "1": "playerA", "-1": "playerB" };
    const options = {
      players,
      activePlayers: ["playerA"],
      initialSubGames: [
        { id: "game1", type: "tictactoe", options: { players } },
        { id: "game2", type: "tictactoe", options: { players } },
      ],
      // 初期化時のリゾルバ
      rulesetResolver: (type: string) => (type === "tictactoe" ? TicTacToeRuleset : null),
    };

    let state = MetaGameRuleset.getInitialState(options);
    expect(Object.keys(state.subGames)).toHaveLength(2);
    expect(state.subGames["game1"].type).toBe("tictactoe");
    expect(state.subGames["game2"].type).toBe("tictactoe");

    // 2. game1 にアクションを送って勝利させる
    // playerA: 0, 1, 2 (Win)
    // playerB: 3, 4
    const moves: TicTacToeAction[] = [
      { type: "PLACE", index: 0, playerId: "playerA" },
      { type: "PLACE", index: 3, playerId: "playerB" },
      { type: "PLACE", index: 1, playerId: "playerA" },
      { type: "PLACE", index: 4, playerId: "playerB" },
      { type: "PLACE", index: 2, playerId: "playerA" },
    ];

    for (const subAction of moves) {
      const metaAction: MetaGameAction & { _resolvedRuleset: any } = {
        type: "SUBGAME_ACTION",
        subGameId: "game1",
        subAction,
        _resolvedRuleset: TicTacToeRuleset,
      };
      state = MetaGameRuleset.reduce(state, metaAction);
    }

    // 3. 状態の確認
    // game1 は終了しているはず
    expect(state.subGames["game1"].state.status).toBe("FINISHED");
    // playerA のメタスコアが 1 になっているはず
    expect(state.metaScores["playerA"]).toBe(1);

    // game2 はまだ進行中（または開始状態）
    expect(state.subGames["game2"].state.status).toBe("PLAYING");

    // 4. メタゲームの勝利条件（ここではスコア3だが、全ゲーム終了時もチェック）
    // game2 も playerA に勝たせる
    for (const subAction of moves) {
      const metaAction: MetaGameAction & { _resolvedRuleset: any } = {
        type: "SUBGAME_ACTION",
        subGameId: "game2",
        subAction,
        _resolvedRuleset: TicTacToeRuleset,
      };
      state = MetaGameRuleset.reduce(state, metaAction);
    }

    expect(state.metaScores["playerA"]).toBe(2);

    // 全てのサブゲームが終了したので、メタゲームも終了するかチェック
    const winResult = MetaGameRuleset.checkWinCondition(state);
    expect(winResult.isFinished).toBe(true);
    expect(winResult.winnerIds).toContain("playerA");
    expect(state.message).toContain("Sub-game game2 finished.");
  });
});
