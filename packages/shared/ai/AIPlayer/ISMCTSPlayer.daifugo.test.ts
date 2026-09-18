import { describe, expect, it } from "bun:test";
import { DaifugoRuleset, type Card, type DaifugoState } from "@engine/shared/rules/DaifugoRuleset";
import { DaifugoDeterminizer } from "@engine/shared/ai/Determinizer/DaifugoDeterminizer";
import { InformationSetMCTSPlayer } from "@engine/shared/ai/AIPlayer/ISMCTSPlayer";

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
    kakumei: false,
    revolution: false,
    eightGiri: false,
    ...overrides,
  };
}

describe("InformationSetMCTSPlayer (Daifugo)", () => {
  const determinizer = new DaifugoDeterminizer();
  const ai = new InformationSetMCTSPlayer(AI, DaifugoRuleset, determinizer, { iterations: 500 });

  function legalActionsFor(state: DaifugoState) {
    return DaifugoRuleset.getLegalActions(determinizer.determinize(state, AI), AI);
  }

  it("leads with the joker to guarantee the win when opponents hold one card each", async () => {
    // JR を出せば誰も上乗せできず、場が流れて 3S で上がれる。3S を先に出すと抜かれて負ける可能性がある
    const state = maskedState(["3S", "JR"], [1, 1]);
    const move = await ai.computeNextMove(state, legalActionsFor(state));
    expect(move).toEqual({ type: "PLAY", cards: ["JR"], playerId: AI });
  });

  it("plays its last card instead of passing", async () => {
    const state = maskedState(["2S"], [3, 3], {
      tableCards: ["9H"],
      playedCards: ["9H"],
      lastPlayedPlayerId: "p3",
    });
    const move = await ai.computeNextMove(state, legalActionsFor(state));
    expect(move?.type).toBe("PLAY");
  });
});
