// packages/shared/rules/mahjong/MahjongTiles.ts
//
// 牌の表現と、和了形・聴牌・待ち牌の判定（役や点数は MahjongHandEvaluator が riichi パッケージで計算する）。
// 牌は "1m".."9m" / "1p".."9p" / "1s".."9s" / "1z".."7z"（東南西北白發中）の 2 文字。"0m" 等は赤五。

export type Tile = string;

/** 34 種の牌インデックス: 萬 0-8, 筒 9-17, 索 18-26, 字 27-33 */
export const TILE_KINDS = 34;

const SUIT_OFFSET: Record<string, number> = { m: 0, p: 9, s: 18, z: 27 };

/** 赤五（"0m"）を通常の五（"5m"）に正規化する */
export function normalizeTile(tile: Tile): Tile {
  return tile[0] === "0" ? `5${tile[1]}` : tile;
}

export function isRedFive(tile: Tile): boolean {
  return tile[0] === "0";
}

export function isSameTile(a: Tile, b: Tile): boolean {
  return normalizeTile(a) === normalizeTile(b);
}

export function tileIndex(tile: Tile): number {
  const normalized = normalizeTile(tile);
  const offset = SUIT_OFFSET[normalized[1]!];
  const number = Number(normalized[0]);
  if (offset === undefined || !Number.isInteger(number) || number < 1) {
    throw new Error(`Invalid tile: ${tile}`);
  }
  if (normalized[1] === "z" ? number > 7 : number > 9) throw new Error(`Invalid tile: ${tile}`);
  return offset + number - 1;
}

export function tileFromIndex(index: number): Tile {
  if (index < 27) {
    const suit = index < 9 ? "m" : index < 18 ? "p" : "s";
    return `${(index % 9) + 1}${suit}`;
  }
  return `${index - 27 + 1}z`;
}

export function isHonor(tile: Tile): boolean {
  return tile[1] === "z";
}

/** 么九牌（一・九・字牌） */
export function isTerminalOrHonor(tile: Tile): boolean {
  const normalized = normalizeTile(tile);
  return normalized[1] === "z" || normalized[0] === "1" || normalized[0] === "9";
}

export function tileNumber(tile: Tile): number {
  return Number(normalizeTile(tile)[0]);
}

export function tileSuit(tile: Tile): string {
  return tile[1]!;
}

export function countTile(hand: Tile[], tile: Tile): number {
  const target = normalizeTile(tile);
  return hand.filter((candidate) => normalizeTile(candidate) === target).length;
}

/** 手牌から指定の牌を 1 枚ずつ取り除く（見つからない牌があれば undefined） */
export function removeTiles(hand: Tile[], tiles: Tile[]): Tile[] | undefined {
  const rest = [...hand];
  for (const tile of tiles) {
    const index = rest.indexOf(tile);
    if (index < 0) return undefined;
    rest.splice(index, 1);
  }
  return rest;
}

export function toCounts(tiles: Tile[]): number[] {
  const counts = new Array<number>(TILE_KINDS).fill(0);
  for (const tile of tiles) counts[tileIndex(tile)]++;
  return counts;
}

/** 牌の並び順（種類 → 数字、赤五は五の直前） */
export function compareTiles(a: Tile, b: Tile): number {
  const diff = tileIndex(a) - tileIndex(b);
  if (diff !== 0) return diff;
  return Number(isRedFive(b)) - Number(isRedFive(a));
}

export function sortTiles(tiles: Tile[]): Tile[] {
  return [...tiles].sort(compareTiles);
}

/** 3 枚が同種の連続する数牌（順子）か */
export function isSequence(tiles: Tile[]): boolean {
  if (tiles.length !== 3 || tiles.some(isHonor)) return false;
  const suit = tileSuit(tiles[0]!);
  if (tiles.some((tile) => tileSuit(tile) !== suit)) return false;
  const numbers = tiles.map(tileNumber).sort((a, b) => a - b);
  return numbers[0]! + 1 === numbers[1] && numbers[1]! + 1 === numbers[2];
}

// --- 和了形判定 ---

function canFormSets(counts: number[]): boolean {
  const first = counts.findIndex((count) => count > 0);
  if (first < 0) return true;
  if (counts[first]! >= 3) {
    counts[first] -= 3;
    const ok = canFormSets(counts);
    counts[first] += 3;
    if (ok) return true;
  }
  if (first < 27 && first % 9 <= 6 && counts[first + 1]! > 0 && counts[first + 2]! > 0) {
    counts[first]--;
    counts[first + 1]--;
    counts[first + 2]--;
    const ok = canFormSets(counts);
    counts[first]++;
    counts[first + 1]++;
    counts[first + 2]++;
    if (ok) return true;
  }
  return false;
}

/** 4 面子 1 雀頭（副露分は除いた枚数で渡す: 14, 11, 8, 5, 2 枚） */
export function isStandardComplete(counts: number[]): boolean {
  const total = counts.reduce((sum, count) => sum + count, 0);
  if (total % 3 !== 2) return false;
  for (let pair = 0; pair < TILE_KINDS; pair++) {
    if (counts[pair]! < 2) continue;
    counts[pair] -= 2;
    const ok = canFormSets(counts);
    counts[pair] += 2;
    if (ok) return true;
  }
  return false;
}

/** 七対子（同じ牌 4 枚を 2 対子とは数えない） */
export function isSevenPairs(counts: number[]): boolean {
  let pairs = 0;
  let total = 0;
  for (const count of counts) {
    total += count;
    if (count === 2) pairs++;
  }
  return total === 14 && pairs === 7;
}

const YAOCHU_INDICES = [0, 8, 9, 17, 18, 26, 27, 28, 29, 30, 31, 32, 33];

/** 国士無双 */
export function isThirteenOrphans(counts: number[]): boolean {
  const total = counts.reduce((sum, count) => sum + count, 0);
  if (total !== 14) return false;
  let pair = false;
  for (const index of YAOCHU_INDICES) {
    const count = counts[index]!;
    if (count === 0 || count > 2) return false;
    if (count === 2) {
      if (pair) return false;
      pair = true;
    }
  }
  return pair;
}

/** 手牌（副露を除く）が和了形か。 */
export function isCompleteHand(tiles: Tile[]): boolean {
  const counts = toCounts(tiles);
  return isStandardComplete(counts) || isSevenPairs(counts) || isThirteenOrphans(counts);
}

/** 聴牌形の手牌（副露を除く 13, 10, 7, 4, 1 枚）に対する待ち牌（正規化済み、昇順） */
export function waitingTiles(tiles: Tile[]): Tile[] {
  const counts = toCounts(tiles);
  const total = counts.reduce((sum, count) => sum + count, 0);
  if (total % 3 !== 1) return [];
  const waits: Tile[] = [];
  for (let index = 0; index < TILE_KINDS; index++) {
    if (counts[index]! >= 4) continue;
    counts[index]++;
    if (isStandardComplete(counts) || isSevenPairs(counts) || isThirteenOrphans(counts)) {
      waits.push(tileFromIndex(index));
    }
    counts[index]--;
  }
  return waits;
}

export function isTenpai(tiles: Tile[]): boolean {
  return waitingTiles(tiles).length > 0;
}

/** ドラ表示牌からドラを求める */
export function nextDoraTile(indicator: Tile): Tile {
  const normalized = normalizeTile(indicator);
  const number = Number(normalized[0]);
  const suit = normalized[1]!;
  if (suit === "z") {
    // 東南西北 → 東、白發中 → 白
    if (number <= 4) return `${number === 4 ? 1 : number + 1}z`;
    return `${number === 7 ? 5 : number + 1}z`;
  }
  return `${number === 9 ? 1 : number + 1}${suit}`;
}

/** 九種九牌の判定用: 么九牌の種類数 */
export function distinctTerminalHonorCount(tiles: Tile[]): number {
  return new Set(tiles.filter(isTerminalOrHonor).map(normalizeTile)).size;
}

/** 4 枚の牌（赤五を含んでもよい）を種類順に並べて返す。同じ種類か検証する */
export function isSameKind(tiles: Tile[]): boolean {
  if (tiles.length === 0) return false;
  const target = normalizeTile(tiles[0]!);
  return tiles.every((tile) => normalizeTile(tile) === target);
}
