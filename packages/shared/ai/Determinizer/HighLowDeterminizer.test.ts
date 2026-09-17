import { describe, expect, it } from "bun:test";
import type { Card, HighLowState } from "../../rules/HighLowRuleset";
import { HighLowDeterminizer } from "./HighLowDeterminizer";

const HIDDEN_CARD = { suit: "?", rank: 0 } as unknown as Card;

function maskedState(
  deckSize: number,
  baseCard: Card | null,
  lastResultCard: Card | null = null,
): HighLowState {
  return {
    status: "PLAYING",
    deck: Array.from({ length: deckSize }, () => HIDDEN_CARD),
    currentTurn: 1,
    baseCard,
    lastGuess: null,
    lastResultCard,
    scores: { 1: 0, 2: 0 },
    round: 1,
    players: { 1: "ai", 2: "human" },
    activePlayers: ["ai"],
  };
}

const cardKey = (c: Card) => `${c.suit}${c.rank}`;

describe("HighLowDeterminizer", () => {
  const determinizer = new HighLowDeterminizer();

  it("keeps the deck size and fills it with real cards", () => {
    const result = determinizer.determinize(maskedState(30, { suit: "♠", rank: 2 }), "ai");

    expect(result.deck).toHaveLength(30);
    for (const card of result.deck) {
      expect(["♠", "♥", "♦", "♣"]).toContain(card.suit);
      expect(card.rank).toBeGreaterThanOrEqual(1);
      expect(card.rank).toBeLessThanOrEqual(13);
    }
  });

  it("excludes visible cards and never duplicates a card", () => {
    const base = { suit: "♠", rank: 2 } as const;
    const last = { suit: "♥", rank: 11 } as const;
    // 52 - 2 枚 = 50 枚が上限なので、全て引かせて重複が無いことを確かめる
    const result = determinizer.determinize(maskedState(50, base, last), "ai");

    const keys = result.deck.map(cardKey);
    expect(new Set(keys).size).toBe(50);
    expect(keys).not.toContain(cardKey(base));
    expect(keys).not.toContain(cardKey(last));
  });

  it("does not mutate the masked state", () => {
    const state = maskedState(10, { suit: "♦", rank: 7 });
    const before = structuredClone(state);
    determinizer.determinize(state, "ai");
    expect(state).toEqual(before);
  });

  it("re-samples the deck on every call", () => {
    const state = maskedState(30, { suit: "♣", rank: 5 });
    const first = determinizer.determinize(state, "ai").deck.map(cardKey).join(",");
    const second = determinizer.determinize(state, "ai").deck.map(cardKey).join(",");
    expect(first).not.toBe(second);
  });
});
