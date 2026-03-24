// packages/shared/rules/__tests__/NovelRuleset.test.ts
import { describe, it, expect } from "bun:test";
import { NovelRuleset } from "../NovelRuleset";
import type { ScenarioNode } from "../../utils/ScenarioEngine";

const testScenario: Record<string, ScenarioNode> = {
  start: {
    type: "text",
    speaker: "Guide",
    text: "Welcome to the adventure!",
    next: "choice1",
  },
  choice1: {
    type: "choice",
    choices: [
      {
        text: "Go Left",
        next: "left_path",
        actions: [{ type: "set", flag: "path", value: "left" }],
      },
      {
        text: "Go Right",
        next: "right_path",
        actions: [{ type: "set", flag: "path", value: "right" }],
      },
    ],
  },
  left_path: { type: "text", text: "You see a dragon.", next: "check_strength" },
  right_path: { type: "text", text: "You see a treasure chest.", next: "end" },
  check_strength: {
    type: "condition",
    if: "strength > 10",
    then: "win_fight",
    else: "lose_fight",
  },
  win_fight: { type: "end", message: "You defeated the dragon!" },
  lose_fight: { type: "end", message: "The dragon ate you." },
  end: { type: "end", message: "You found the treasure!" },
};

describe("NovelRuleset", () => {
  it("ダイアログの進行と選択肢による分岐が正しく動作する", () => {
    let state = NovelRuleset.getInitialState({
      scenario: testScenario,
      initialFlags: { strength: 5 },
      players: { 1: "playerA" },
    });

    // 1. 最初は start ノード
    expect(state.currentNodeId).toBe("start");

    // NEXT アクション
    state = NovelRuleset.reduce(state, { type: "NEXT", playerId: "playerA" });
    expect(state.currentNodeId).toBe("choice1");

    // 2. 選択肢 (Go Left)
    state = NovelRuleset.reduce(state, {
      type: "SELECT",
      choiceIndex: 0,
      playerId: "playerA",
    });
    expect(state.currentNodeId).toBe("left_path");
    expect(state.flags.path).toBe("left");

    // 3. 次へ (条件分岐 check_strength へ)
    // strength が 5 (<= 10) なので lose_fight にジャンプするはず
    state = NovelRuleset.reduce(state, { type: "NEXT", playerId: "playerA" });
    expect(state.currentNodeId).toBe("lose_fight");
    expect(state.status).toBe("FINISHED");
    expect(state.message).toBe("The dragon ate you.");
  });

  it("条件分岐がフラグの状態に応じて変化する", () => {
    let state = NovelRuleset.getInitialState({
      scenario: testScenario,
      initialFlags: { strength: 15 }, // 10より大きい
      players: { 1: "playerA" },
    });

    // start -> choice1
    state = NovelRuleset.reduce(state, { type: "NEXT", playerId: "playerA" });
    // choice1 -> left_path
    state = NovelRuleset.reduce(state, {
      type: "SELECT",
      choiceIndex: 0,
      playerId: "playerA",
    });
    // left_path -> (condition) -> win_fight
    state = NovelRuleset.reduce(state, { type: "NEXT", playerId: "playerA" });

    expect(state.currentNodeId).toBe("win_fight");
    expect(state.status).toBe("FINISHED");
    expect(state.message).toBe("You defeated the dragon!");
  });
});
