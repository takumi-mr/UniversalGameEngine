import { createSecret, isSecret, type Secret } from "../../GameRules";
import type { IAIStateDeterminizer } from "../IAIStateDeterminizer";
import { buildFullDeck, type Card, type DaifugoState } from "../../rules/DaifugoRuleset";

// エンジンのマスク後は Secret が剥がされて Card[]（他人の手札は "?" の配列）になる
type MaybeMaskedHand = Secret<Card[]> | Card[];

function handCards(hand: MaybeMaskedHand | undefined): Card[] {
  if (!hand) return [];
  return isSecret(hand) ? (hand.value as Card[]) : hand;
}

function removeOnce(deck: Card[], cards: Card[]): void {
  for (const card of cards) {
    const i = deck.indexOf(card);
    if (i >= 0) deck.splice(i, 1);
  }
}

/**
 * 「自分の手札」と「既に場に出たカード」以外の全カードを、相手の手札枚数に合わせてランダムに配り直す
 */
export class DaifugoDeterminizer implements IAIStateDeterminizer<DaifugoState> {
  determinize(maskedState: DaifugoState, viewpointPlayerId: string): DaifugoState {
    const hands = maskedState.hands as Record<string, MaybeMaskedHand>;
    const ownHand = handCards(hands[viewpointPlayerId]);

    const unseen = buildFullDeck();
    removeOnce(unseen, ownHand);
    removeOnce(unseen, maskedState.playedCards);

    for (let i = unseen.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [unseen[i], unseen[j]] = [unseen[j], unseen[i]];
    }

    const determinizedHands: Record<string, Secret<Card[]>> = {};
    for (const playerId of maskedState.playerIds) {
      const cards =
        playerId === viewpointPlayerId
          ? ownHand
          : unseen.splice(0, handCards(hands[playerId]).length);
      determinizedHands[playerId] = createSecret(
        cards,
        [playerId],
        cards.map(() => "?"),
      );
    }

    return { ...maskedState, hands: determinizedHands };
  }
}
