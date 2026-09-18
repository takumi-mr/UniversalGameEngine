import type { IAIStateDeterminizer } from "@engine/shared/ai/IAIStateDeterminizer";
import type { Card, HighLowState, Suit } from "@engine/shared/rules/HighLowRuleset";

const SUITS: Suit[] = ["♠", "♥", "♦", "♣"];

function isSameCard(a: Card | null, b: Card): boolean {
  return a !== null && a.suit === b.suit && a.rank === b.rank;
}

/**
 * 山札の中身は見えないので、「場に出ているカード以外」から山札と同じ枚数をランダムに引き直す
 */
export class HighLowDeterminizer implements IAIStateDeterminizer<HighLowState> {
  determinize(maskedState: HighLowState, _viewpointPlayerId: string): HighLowState {
    const unseen: Card[] = [];
    for (const suit of SUITS) {
      for (let rank = 1; rank <= 13; rank++) {
        const card = { suit, rank };
        if (isSameCard(maskedState.baseCard, card)) continue;
        if (isSameCard(maskedState.lastResultCard, card)) continue;
        unseen.push(card);
      }
    }

    for (let i = unseen.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [unseen[i], unseen[j]] = [unseen[j], unseen[i]];
    }

    return { ...maskedState, deck: unseen.slice(0, maskedState.deck.length) };
  }
}
