// apps/frontend/src/utils/mahjong.ts
// 麻雀 UI の表示用ヘルパー（牌の日本語表記・席風）
import { createSecret } from "@engine/shared/GameRules";
import { WINDS, type MahjongState, type Wind } from "@engine/shared/rules/mahjong/MahjongRuleset";
import type { Tile } from "@engine/shared/rules/mahjong/MahjongTiles";
import { revealed } from "@/utils/revealed";

const HONORS = ["", "東", "南", "西", "北", "白", "發", "中"];
const SUITS: Record<string, string> = { m: "萬", p: "筒", s: "索" };

/** "3m" → "3萬", "0p" → "赤5筒", "7z" → "中" */
export function tileLabel(tile: Tile | "?"): string {
  if (tile === "?") return "?";
  const number = tile[0];
  const suit = tile[1] ?? "";
  if (suit === "z") return HONORS[Number(number)] ?? tile;
  if (number === "0") return `赤5${SUITS[suit] ?? ""}`;
  return `${number}${SUITS[suit] ?? suit}`;
}

/** その局でのプレイヤーの自風（親が東） */
export function seatWindOf(
  hand: Pick<MahjongState, "playerIds" | "dealerIndex">,
  id: string,
): Wind {
  const index = hand.playerIds.indexOf(id);
  const count = hand.playerIds.length || 4;
  return WINDS[(((index - hand.dealerIndex) % count) + count) % count] ?? "EAST";
}

/**
 * サーバーから届く局の状態は Secret が展開済み（自分の手牌は牌の配列、他家は "?" の配列、山は "?" の配列）なので、
 * そのままではルールセットの getLegalActions が手牌や山の枚数を読めない。
 * 合法手の計算用に、展開された値を Secret に包み直す（枚数と自分の手牌だけ合っていればよい）。
 */
export function rewrapForRules(hand: MahjongState): MahjongState {
  const tiles = (secret: unknown) => revealed<Tile[]>(secret as MahjongState["wall"]) ?? [];
  return {
    ...hand,
    wall: createSecret(tiles(hand.wall), []),
    deadWall: createSecret(tiles(hand.deadWall), []),
    hands: Object.fromEntries(
      Object.entries(hand.hands).map(([id, h]) => [id, createSecret(tiles(h), [id])]),
    ),
  };
}
