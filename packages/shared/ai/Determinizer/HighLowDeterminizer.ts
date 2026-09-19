import type { IAIStateDeterminizer } from "@engine/shared/ai/IAIStateDeterminizer";
import {
  secretDeck,
  type Card,
  type HighLowState,
  type Suit,
} from "@engine/shared/rules/HighLowRuleset";
import { isSecret } from "@engine/shared/GameRules";

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

    // 山札は Secret<Card[]>。マスク済み状態では枚数分の "?" の配列に展開されているので、どちらでも枚数を取れるようにする
    const deck: unknown = maskedState.deck;
    const size = isSecret(deck)
      ? (deck.value as Card[]).length
      : Array.isArray(deck)
        ? deck.length
        : 0;
    return { ...maskedState, deck: secretDeck(unseen.slice(0, size)) };
  }
}
