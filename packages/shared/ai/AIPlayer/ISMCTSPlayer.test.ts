import { describe, expect, it } from "bun:test";
import {
  HighLowRuleset,
  secretDeck,
  type Card,
  type HighLowState,
} from "@engine/shared/rules/HighLowRuleset";
import { HighLowDeterminizer } from "@engine/shared/ai/Determinizer/HighLowDeterminizer";
import { InformationSetMCTSPlayer } from "@engine/shared/ai/AIPlayer/ISMCTSPlayer";

// 山札の中身は AI から見えない前提なので、枚数だけ合わせたダミーで埋める（実際の山札はルールセット外から見えない Secret）
const HIDDEN_CARD = { suit: "?", rank: 0 } as unknown as Card;

// 4-4 のマッチポイントにして、この 1 手の正否がそのまま勝敗に直結するようにする
function maskedState(baseCard: Card, deckSize: number): HighLowState {
  return {
    status: "PLAYING",
    deck: secretDeck(Array.from({ length: deckSize }, () => HIDDEN_CARD)),
    currentTurn: 1,
    baseCard,
    lastGuess: null,
    lastResultCard: null,
    scores: { 1: 4, 2: 4 },
    round: 1,
    players: { 1: "ai", 2: "human" },
    activePlayers: ["ai"],
  };
}

describe("InformationSetMCTSPlayer", () => {
  const ai = new InformationSetMCTSPlayer("ai", HighLowRuleset, new HighLowDeterminizer(), {
    iterations: 500,
  });

  it("guesses HIGH when the base card is low", async () => {
    const state = maskedState({ suit: "♠", rank: 2 }, 30);
    const move = await ai.computeNextMove(state, HighLowRuleset.getLegalActions(state, "ai"));
    expect(move).toEqual({ type: "GUESS", choice: "HIGH", playerId: "ai" });
  });

  it("guesses LOW when the base card is high", async () => {
    const state = maskedState({ suit: "♥", rank: 12 }, 30);
    const move = await ai.computeNextMove(state, HighLowRuleset.getLegalActions(state, "ai"));
    expect(move).toEqual({ type: "GUESS", choice: "LOW", playerId: "ai" });
  });

  it("never peeks at the real deck", async () => {
    // 実際の山札の次は K（HIGH が正解）だが、9 を基準に確率で判断すれば LOW を選ぶはず
    const state = maskedState({ suit: "♠", rank: 9 }, 30);
    state.deck.value[state.deck.value.length - 1] = { suit: "♣", rank: 13 };
    const move = await ai.computeNextMove(state, HighLowRuleset.getLegalActions(state, "ai"));
    expect(move?.type === "GUESS" && move.choice).toBe("LOW");
  });
});
