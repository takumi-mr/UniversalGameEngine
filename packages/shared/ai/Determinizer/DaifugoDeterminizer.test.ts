import { describe, expect, it } from "bun:test";
import { createSecret } from "../../GameRules";
import { buildFullDeck, type Card, type DaifugoState } from "../../rules/DaifugoRuleset";
import { DaifugoDeterminizer } from "./DaifugoDeterminizer";

const AI = "ai";
const OPPONENTS = ["p2", "p3"];

// エンジンのマスク後の形: 自分の手札は素の配列、相手の手札は "?" の配列
function maskedState(
  ownHand: Card[],
  opponentHandSizes: number[],
  overrides: Partial<DaifugoState> = {},
): DaifugoState {
  const hands: Record<string, Card[]> = { [AI]: ownHand };
  OPPONENTS.forEach((id, i) => {
    hands[id] = Array.from({ length: opponentHandSizes[i] }, () => "?");
  });
  return {
    status: "PLAYING",
    playerIds: [AI, ...OPPONENTS],
    players: { [AI]: AI, p2: "p2", p3: "p3" },
    activePlayers: [AI],
    hands: hands as unknown as DaifugoState["hands"],
    tableCards: [],
    playedCards: [],
    lastPlayedPlayerId: null,
    passedPlayers: [],
    turnIndex: 0,
    ranks: [],
    ...overrides,
  };
}

function countCards(cards: Card[]): Map<Card, number> {
  const counts = new Map<Card, number>();
  for (const c of cards) counts.set(c, (counts.get(c) ?? 0) + 1);
  return counts;
}

function expectWithinDeck(cards: Card[]): void {
  const deckCounts = countCards(buildFullDeck());
  for (const [card, n] of countCards(cards)) {
    expect(n).toBeLessThanOrEqual(deckCounts.get(card) ?? 0);
  }
}

describe("DaifugoDeterminizer", () => {
  const determinizer = new DaifugoDeterminizer();

  it("deals unseen cards to opponents matching their hand sizes", () => {
    const own = ["3S", "JR", "AS"];
    const played = ["4H", "4D", "KC"];
    const state = maskedState(own, [5, 7], { playedCards: played });

    const result = determinizer.determinize(state, AI);

    expect(result.hands[AI].value).toEqual(own);
    expect(result.hands.p2.value).toHaveLength(5);
    expect(result.hands.p3.value).toHaveLength(7);
    expectWithinDeck([...own, ...played, ...result.hands.p2.value, ...result.hands.p3.value]);
  });

  it("handles the two jokers as a multiset", () => {
    // 自分が JR を 1 枚持っていれば、相手側に配られる JR は最大 1 枚
    const own = ["JR"];
    const state = maskedState(own, [26, 27]);

    const result = determinizer.determinize(state, AI);

    const opponentJokers = [...result.hands.p2.value, ...result.hands.p3.value].filter(
      (c) => c === "JR",
    );
    expect(opponentJokers).toHaveLength(1);
  });

  it("accepts an unmasked state with Secret hands", () => {
    const own = ["3S", "5H"];
    const state = maskedState(own, [0, 0]);
    state.hands = {
      [AI]: createSecret(own, [AI]),
      p2: createSecret(["2S", "2H", "2D"], ["p2"]),
      p3: createSecret(["AS"], ["p3"]),
    };

    const result = determinizer.determinize(state, AI);

    expect(result.hands[AI].value).toEqual(own);
    expect(result.hands.p2.value).toHaveLength(3);
    expect(result.hands.p3.value).toHaveLength(1);
    expectWithinDeck([...own, ...result.hands.p2.value, ...result.hands.p3.value]);
  });

  it("wraps every hand in a Secret visible only to its owner", () => {
    const result = determinizer.determinize(maskedState(["3S"], [2, 2]), AI);
    for (const id of [AI, ...OPPONENTS]) {
      expect(result.hands[id].__isSecret).toBe(true);
      expect(result.hands[id].visibleTo).toEqual([id]);
    }
  });

  it("does not mutate the masked state", () => {
    const state = maskedState(["3S", "JR"], [4, 4], { playedCards: ["9H"] });
    const before = structuredClone(state);
    determinizer.determinize(state, AI);
    expect(state).toEqual(before);
  });

  it("re-samples opponent hands on every call", () => {
    const state = maskedState(["3S"], [10, 10]);
    const first = determinizer.determinize(state, AI).hands.p2.value.join(",");
    const second = determinizer.determinize(state, AI).hands.p2.value.join(",");
    expect(first).not.toBe(second);
  });
});
