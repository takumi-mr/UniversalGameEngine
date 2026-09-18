// packages/shared/rules/__tests__/PokerHandEvaluator.test.ts
import { describe, it, expect } from "bun:test";
import {
  compareHandRanks,
  evaluateBestHand,
  evaluateFiveCards,
} from "@engine/shared/rules/PokerHandEvaluator";

const rank = (...cards: string[]) => evaluateFiveCards(cards);
const beats = (a: string[], b: string[]) => compareHandRanks(rank(...a), rank(...b)) > 0;

describe("PokerHandEvaluator", () => {
  it("5 枚の役を正しく分類する", () => {
    expect(rank("AS", "KS", "QS", "JS", "TS").name).toBe("Royal Flush");
    expect(rank("9H", "8H", "7H", "6H", "5H").name).toBe("Straight Flush");
    expect(rank("9H", "9D", "9C", "9S", "2H").name).toBe("Four of a Kind");
    expect(rank("9H", "9D", "9C", "2S", "2H").name).toBe("Full House");
    expect(rank("AH", "9H", "7H", "4H", "2H").name).toBe("Flush");
    expect(rank("9H", "8D", "7C", "6S", "5H").name).toBe("Straight");
    expect(rank("9H", "9D", "9C", "5S", "2H").name).toBe("Three of a Kind");
    expect(rank("9H", "9D", "5C", "5S", "2H").name).toBe("Two Pair");
    expect(rank("9H", "9D", "7C", "5S", "2H").name).toBe("One Pair");
    expect(rank("KH", "9D", "7C", "5S", "2H").name).toBe("High Card");
  });

  it("A-2-3-4-5（ホイール）はストレートで、6 ハイのストレートより弱い", () => {
    const wheel = rank("AH", "2D", "3C", "4S", "5H");
    expect(wheel.name).toBe("Straight");
    expect(beats(["6H", "5D", "4C", "3S", "2H"], ["AH", "2D", "3C", "4S", "5H"])).toBe(true);
    // A-K-Q-J-T は最強のストレート
    expect(beats(["AH", "KD", "QC", "JS", "TH"], ["KH", "QD", "JC", "TS", "9H"])).toBe(true);
    // K-A-2-3-4 のような「回り込み」はストレートではない
    expect(rank("KH", "AD", "2C", "3S", "4H").name).toBe("High Card");
  });

  it("役の優劣とキッカーを比較する", () => {
    // 役の種類が優先
    expect(beats(["2H", "2D", "2C", "3S", "3H"], ["AH", "KH", "QH", "JH", "2H"])).toBe(true);
    // 同じ役ならランクで比較（ワンペア: ペアのランク → キッカー）
    expect(beats(["3H", "3D", "AC", "KS", "2H"], ["2H", "2D", "AC", "KS", "QH"])).toBe(true);
    expect(beats(["9H", "9D", "AC", "5S", "2H"], ["9C", "9S", "KC", "QS", "JH"])).toBe(true);
    // ツーペアは上のペア → 下のペア → キッカー
    expect(beats(["KH", "KD", "2C", "2S", "3H"], ["QH", "QD", "JC", "JS", "AH"])).toBe(true);
    expect(beats(["KH", "KD", "3C", "3S", "2H"], ["KC", "KS", "2C", "2D", "AH"])).toBe(true);
    // フルハウスはスリーカード部分が優先
    expect(beats(["9H", "9D", "9C", "2S", "2H"], ["8H", "8D", "8C", "AS", "AH"])).toBe(true);
    // フラッシュ・ハイカードは上から順に比較
    expect(beats(["AH", "9H", "7H", "4H", "2H"], ["KH", "QH", "JH", "9H", "2H"])).toBe(true);
    expect(beats(["AH", "9D", "7C", "4S", "3H"], ["AC", "9S", "7D", "4H", "2H"])).toBe(true);
    // スートは強さに影響しない（完全同点）
    expect(
      compareHandRanks(rank("AH", "KD", "7C", "4S", "2H"), rank("AC", "KS", "7D", "4H", "2C")),
    ).toBe(0);
  });

  it("7 枚から最強の 5 枚を選ぶ", () => {
    // ボードでストレート、手札のペアより強い
    const straight = evaluateBestHand(["9H", "9D", "TC", "JS", "QH", "KD", "2C"]);
    expect(straight.name).toBe("Straight");
    expect(straight.cards.sort()).toEqual(["9H", "TC", "JS", "QH", "KD"].sort());

    // 6 枚同スートの中から最も高い 5 枚のフラッシュ
    const flush = evaluateBestHand(["2H", "5H", "9H", "JH", "KH", "AH", "AS"]);
    expect(flush.name).toBe("Flush");
    expect(flush.cards.sort()).toEqual(["5H", "9H", "JH", "KH", "AH"].sort());

    // ペア + ボードのスリーカードでフルハウス
    expect(evaluateBestHand(["AS", "AH", "7C", "7D", "7H", "2S", "3D"]).name).toBe("Full House");

    expect(() => evaluateBestHand(["AS", "AH", "7C", "7D"])).toThrow();
  });
});
