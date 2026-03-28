// packages/shared/ai/LLMPlayer.test.ts
import { describe, it, expect } from "bun:test";
import { LLMPlayer, type LLMService } from "./LLMPLayer";
import type { BaseGameState, BaseGameAction } from "../../GameRules";

describe("LLMPlayer", () => {
  const dummyState: BaseGameState = {
    status: "PLAYING",
    players: { 1: "p1", 2: "p2" },
    activePlayers: ["p1"],
  };

  const dummyActions: BaseGameAction[] = [
    { type: "MOVE", playerId: "p1" },
    { type: "JUMP", playerId: "p1" },
    { type: "STAY", playerId: "p1" },
  ];

  it("should select the action index returned by LLM", async () => {
    const mockLLM: LLMService = {
      chat: async () => "1", // Select "JUMP"
    };

    const player = new LLMPlayer("p1", mockLLM);
    const result = await player.computeNextMove(dummyState, dummyActions);

    expect(result).not.toBeNull();
    expect(result?.type).toBe("JUMP");
    expect(result?.playerId).toBe("p1");
  });

  it("should handle mixed text and number in LLM response", async () => {
    const mockLLM: LLMService = {
      chat: async () => "I think the best action is 2, because it is safe.",
    };

    const player = new LLMPlayer("p1", mockLLM);
    const result = await player.computeNextMove(dummyState, dummyActions);

    expect(result?.type).toBe("STAY");
  });

  it("should fallback to the first action if LLM returns invalid index", async () => {
    const mockLLM: LLMService = {
      chat: async () => "99", // Out of range
    };

    const player = new LLMPlayer("p1", mockLLM);
    const result = await player.computeNextMove(dummyState, dummyActions);

    expect(result?.type).toBe("MOVE"); // Fallback to index 0
  });

  it("should fallback to the first action if LLM returns no numbers", async () => {
    const mockLLM: LLMService = {
      chat: async () => "Hello world, I don't know what to do.",
    };

    const player = new LLMPlayer("p1", mockLLM);
    const result = await player.computeNextMove(dummyState, dummyActions);

    expect(result?.type).toBe("MOVE"); // Fallback
  });

  it("should retry if LLM fails then succeeds", async () => {
    let callCount = 0;
    const mockLLM: LLMService = {
      chat: async () => {
        callCount++;
        if (callCount === 1) throw new Error("Network error");
        return "1";
      },
    };

    const player = new LLMPlayer("p1", mockLLM, { maxRetries: 1 });
    const result = await player.computeNextMove(dummyState, dummyActions);

    expect(callCount).toBe(2);
    expect(result?.type).toBe("JUMP");
  });

  it("should return the only action immediately without calling LLM", async () => {
    let called = false;
    const mockLLM: LLMService = {
      chat: async () => {
        called = true;
        return "0";
      },
    };

    const player = new LLMPlayer("p1", mockLLM);
    const result = await player.computeNextMove(dummyState, [{ type: "SINGLE", playerId: "p1" }]);

    expect(called).toBe(false);
    expect(result?.type).toBe("SINGLE");
  });
});
