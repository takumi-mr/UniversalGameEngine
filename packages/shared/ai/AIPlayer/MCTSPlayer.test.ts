// packages/shared/ai/MCTSPlayer.test.ts
import { describe, expect, it } from "bun:test";
import { TicTacToeRuleset, type TicTacToeState } from "../../rules/TicTacToeRuleset";
import { MCTSPlayer } from "./MCTSPlayer";

describe("MCTSPlayer", () => {
  const ruleset = TicTacToeRuleset;

  it("should choose the winning move in Tic-Tac-Toe", async () => {
    // O | O | .
    // X | X | .
    // . | . | . (O's turn)
    const state: TicTacToeState = {
      status: "PLAYING",
      board: [1, 1, 0, -1, -1, 0, 0, 0, 0],
      turn: 1,
      players: { "1": "O", "-1": "X" },
      activePlayers: ["O"],
    };

    const ai = new MCTSPlayer("O", ruleset, { iterations: 1000 });
    const legalActions = ruleset.getLegalActions(state, "O");
    const move = await ai.computeNextMove(state, legalActions);

    expect(move).toBeDefined();
    expect(move?.index).toBe(2); // リーチをかけている (0, 1) -> 2 で勝利
  });

  it("should block the opponent's winning move", async () => {
    // X | X | .
    // O | . | .
    // . | . | . (O's turn)
    const state: TicTacToeState = {
      status: "PLAYING",
      board: [-1, -1, 0, 1, 0, 0, 0, 0, 0],
      turn: 1,
      players: { "1": "O", "-1": "X" },
      activePlayers: ["O"],
    };

    const ai = new MCTSPlayer("O", ruleset, { iterations: 1000 });
    const legalActions = ruleset.getLegalActions(state, "O");
    const move = await ai.computeNextMove(state, legalActions);

    expect(move).toBeDefined();
    expect(move?.index).toBe(2); // 相手のリーチを阻止
  });
});
