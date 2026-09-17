// packages/shared/rules/PokerHandEvaluator.ts
//
// ポーカーの役判定。カードは "AS" / "TD" のように「ランク1文字 + スート1文字」の文字列。
// 7 枚（手札 2 + コミュニティ 5）から最強の 5 枚を選ぶ用途を想定している。

export const HAND_CATEGORY_NAMES = [
  "High Card",
  "One Pair",
  "Two Pair",
  "Three of a Kind",
  "Straight",
  "Flush",
  "Full House",
  "Four of a Kind",
  "Straight Flush",
] as const;

export interface HandRank {
  /** 0: ハイカード 〜 8: ストレートフラッシュ */
  category: number;
  /** category を先頭に、同じ役同士の優劣を決める値を強い順に並べたもの */
  tiebreak: number[];
  name: string;
  /** 役を構成する 5 枚 */
  cards: string[];
}

const RANK_ORDER = "23456789TJQKA";

/** カードのランクを 2〜14（A = 14）に変換する */
export function cardRankValue(card: string): number {
  const idx = RANK_ORDER.indexOf(card[0]);
  if (idx < 0) throw new Error(`Invalid card: ${card}`);
  return idx + 2;
}

/** ちょうど 5 枚の役を判定する */
export function evaluateFiveCards(cards: string[]): HandRank {
  if (cards.length !== 5) throw new Error(`evaluateFiveCards expects 5 cards, got ${cards.length}`);

  const values = cards.map(cardRankValue).sort((a, b) => b - a);
  const isFlush = cards.every((c) => c[1] === cards[0][1]);

  // 同じランクの枚数でグループ化し、(枚数 desc, ランク desc) で並べる
  const counts = new Map<number, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const groupValues = groups.map(([v]) => v);
  const pattern = groups.map(([, n]) => n).join("");

  // ストレート判定（A-2-3-4-5 のホイールは 5 ハイ）
  let straightHigh = 0;
  if (groups.length === 5) {
    if (values[0] - values[4] === 4) straightHigh = values[0];
    else if (values[0] === 14 && values[1] === 5 && values[4] === 2) straightHigh = 5;
  }

  let category: number;
  let tiebreak: number[];
  if (straightHigh && isFlush) {
    category = 8;
    tiebreak = [straightHigh];
  } else if (pattern === "41") {
    category = 7;
    tiebreak = groupValues;
  } else if (pattern === "32") {
    category = 6;
    tiebreak = groupValues;
  } else if (isFlush) {
    category = 5;
    tiebreak = values;
  } else if (straightHigh) {
    category = 4;
    tiebreak = [straightHigh];
  } else if (pattern === "311") {
    category = 3;
    tiebreak = groupValues;
  } else if (pattern === "221") {
    category = 2;
    tiebreak = groupValues;
  } else if (pattern === "2111") {
    category = 1;
    tiebreak = groupValues;
  } else {
    category = 0;
    tiebreak = values;
  }

  const name =
    category === 8 && straightHigh === 14 ? "Royal Flush" : HAND_CATEGORY_NAMES[category];
  return { category, tiebreak: [category, ...tiebreak], name, cards: [...cards] };
}

/** 役の強さを比較する（正: a が強い、負: b が強い、0: 同じ強さ） */
export function compareHandRanks(a: HandRank, b: HandRank): number {
  const len = Math.max(a.tiebreak.length, b.tiebreak.length);
  for (let i = 0; i < len; i++) {
    const diff = (a.tiebreak[i] ?? 0) - (b.tiebreak[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** 5 枚以上のカードから最強の 5 枚の役を求める */
export function evaluateBestHand(cards: string[]): HandRank {
  if (cards.length < 5)
    throw new Error(`evaluateBestHand needs at least 5 cards, got ${cards.length}`);
  if (cards.length === 5) return evaluateFiveCards(cards);

  let best: HandRank | null = null;
  const pick: string[] = [];
  const search = (start: number) => {
    if (pick.length === 5) {
      const rank = evaluateFiveCards(pick);
      if (!best || compareHandRanks(rank, best) > 0) best = rank;
      return;
    }
    for (let i = start; i <= cards.length - (5 - pick.length); i++) {
      pick.push(cards[i]);
      search(i + 1);
      pick.pop();
    }
  };
  search(0);
  return best!;
}
