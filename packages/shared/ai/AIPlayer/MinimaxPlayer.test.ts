// packages/shared/ai/MinimaxPlayer.test.ts
import { describe, expect, it } from "bun:test";
import { TicTacToeRuleset, type TicTacToeState } from "../../rules/TicTacToeRuleset";
import { MinimaxPlayer } from "./MinimaxPlayer";

describe("MinimaxPlayer", () => {
  const ruleset = TicTacToeRuleset;

  it("should choose the winning move in Tic-Tac-Toe", async () => {
    // O | O | .
    // X | X | .
    // . | . | . (O's turn)
    const state: TicTacToeState = {
      status: "PLAYING",
      board: [1, 1, 0, -1, -1, 0, 0, 0, 0],
      turn: 1,
      players: { "1": "AI", "-1": "HUMAN" },
      activePlayers: ["AI"],
    };

    const ai = new MinimaxPlayer("AI", ruleset, { maxDepth: 4 });
    const legalActions = ruleset.getLegalActions(state, "AI");
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
      players: { "1": "AI", "-1": "HUMAN" },
      activePlayers: ["AI"],
    };

    const ai = new MinimaxPlayer("AI", ruleset, { maxDepth: 4 });
    const legalActions = ruleset.getLegalActions(state, "AI");
    const move = await ai.computeNextMove(state, legalActions);

    expect(move).toBeDefined();
    expect(move?.index).toBe(2); // 相手のリーチを阻止
  });

  it("should prefer winning over blocking", async () => {
    // O | O | . (O can win at 2)
    // X | X | . (X can win at 5)
    // . | . | . (O's turn)
    const state: TicTacToeState = {
      status: "PLAYING",
      board: [1, 1, 0, -1, -1, 0, 0, 0, 0],
      turn: 1,
      players: { "1": "AI", "-1": "HUMAN" },
      activePlayers: ["AI"],
    };

    const ai = new MinimaxPlayer("AI", ruleset, { maxDepth: 4 });
    const legalActions = ruleset.getLegalActions(state, "AI");
    const move = await ai.computeNextMove(state, legalActions);

    expect(move).toBeDefined();
    expect(move?.index).toBe(2); // 勝利を優先
  });
});
