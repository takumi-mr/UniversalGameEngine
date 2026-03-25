import { describe, it, expect } from "bun:test";
import { TheGameOfLifeRuleset } from "../TheGameOfLifeRuleset";

describe("TheGameOfLifeRuleset", () => {
  it("should initialize with players at the start", () => {
    const state = TheGameOfLifeRuleset.getInitialState({ playerIds: ["A", "B"] });
    expect(state.boardPlayers["A"].position).toBe("START");
    expect(state.boardPlayers["B"].position).toBe("START");
    expect(state.boardPlayers["A"].money).toBe(100000);
    expect(state.activePlayers).toEqual(["A"]);
  });

  it("should move player when spinning", () => {
    let state = TheGameOfLifeRuleset.getInitialState({ playerIds: ["A", "B"] });
    state.status = "PLAYING";

    // Mock RNG to return 0.1 (spin = 1*10 + 1 = 2)
    const mockRNG = { nextFloat: () => 0.1 };

    state = TheGameOfLifeRuleset.reduce(state, { type: "SPIN", playerId: "A" }, mockRNG as any);

    // SPIN result is floor(0.1 * 10) + 1 = 2
    expect(state.lastSpin).toBe(2);
    expect(state.boardPlayers["A"].position).toBe("S2");
    expect(state.boardPlayers["A"].money).toBe(200000); // 100000 + 100000 (S2 effect)
    expect(state.activePlayers).toEqual(["B"]); // Turn passed
  });

  it("should stop at must-stop spaces", () => {
    let state = TheGameOfLifeRuleset.getInitialState({ playerIds: ["A"] });
    state.status = "PLAYING";

    // From START to JOB_HUNT is 3 steps.
    // If spin is 5, it should stop at JOB_HUNT (index 3).
    const mockRNG = { nextFloat: () => 0.4 }; // floor(0.4 * 10) + 1 = 5

    state = TheGameOfLifeRuleset.reduce(state, { type: "SPIN", playerId: "A" }, mockRNG as any);

    expect(state.lastSpin).toBe(5);
    expect(state.boardPlayers["A"].position).toBe("JOB_HUNT");
    expect(state.boardPlayers["A"].job).not.toBeNull(); // Should have assigned a job
  });

  it("should handle goal and winning", () => {
    let state = TheGameOfLifeRuleset.getInitialState({ playerIds: ["A"] });
    state.status = "PLAYING";

    // Jump to near the end
    state.boardPlayers["A"].position = "S11";

    const mockRNG = { nextFloat: () => 0.1 }; // spin = 2
    state = TheGameOfLifeRuleset.reduce(state, { type: "SPIN", playerId: "A" }, mockRNG as any);

    expect(state.boardPlayers["A"].position).toBe("GOAL");
    expect(state.boardPlayers["A"].isFinished).toBe(true);
    expect(state.status).toBe("FINISHED");

    const winResult = TheGameOfLifeRuleset.checkWinCondition(state);
    expect(winResult.isFinished).toBe(true);
    expect(winResult.winnerIds).toEqual(["A"]);
  });
});
