// packages/shared/rules/mahjong/MahjongHandEvaluator.ts
//
// npm `riichi` パッケージで役・符・点数を計算するラッパー。
// 和了形の判定自体は MahjongTiles（isCompleteHand）でもできるが、役の有無と点数はここで確定する。
import Riichi from "riichi";
import type { Meld } from "@engine/shared/rules/mahjong/MahjongRuleset";
import { nextDoraTile, type Tile } from "@engine/shared/rules/mahjong/MahjongTiles";

/** 風: 1=東 2=南 3=西 4=北（riichi パッケージの表記に合わせる） */
export type WindNumber = 1 | 2 | 3 | 4;

/** 和了時の状況（役の成立条件になるもの） */
export interface WinContext {
  roundWind: WindNumber;
  seatWind: WindNumber; // 1 なら親
  doraIndicators: Tile[];
  uraDoraIndicators?: Tile[]; // 立直和了時のみ渡す
  riichi?: boolean;
  doubleRiichi?: boolean;
  ippatsu?: boolean;
  rinshan?: boolean; // 嶺上開花
  chankan?: boolean; // 搶槓
  haitei?: boolean; // 海底摸月（自摸）
  houtei?: boolean; // 河底撈魚（栄和）
  tenhou?: boolean; // 天和（親の配牌自摸）
  chiihou?: boolean; // 地和（子の第一自摸）
  akaDora?: boolean; // 赤ドラ有効（既定 true）
}

export interface EvaluatedHand {
  /** 役のある和了か（和了形でも無役なら false） */
  isAgari: boolean;
  /** 和了形か（無役を含む） */
  isCompleteShape: boolean;
  yaku: Record<string, string>; // e.g. { "立直": "1飜", "平和": "1飜" }
  yakuman: number; // 役満倍数（0 なら通常手）
  han: number;
  fu: number;
  ten: number; // 合計点数（本場・供託は含まない）
  /** 自摸時の支払い: 親和了なら oya[0] を子全員が、子和了なら親が ko[0]、子が ko[1] */
  oya: number[];
  ko: number[];
  text: string;
  dora: number; // ドラ・赤ドラ・裏ドラの合計飜
}

const NO_WIN: EvaluatedHand = {
  isAgari: false,
  isCompleteShape: false,
  yaku: {},
  yakuman: 0,
  han: 0,
  fu: 0,
  ten: 0,
  oya: [0, 0, 0],
  ko: [0, 0, 0],
  text: "",
  dora: 0,
};

const CACHE_LIMIT = 4096;

export class MahjongHandEvaluator {
  private static readonly cache = new Map<string, EvaluatedHand>();

  /**
   * "1m" "2m" のような配列を riichi 表記（例 "12m"）にする。赤五は "0" のまま渡す（赤ドラとして数えられる）
   */
  private static formatTiles(tiles: Tile[]): string {
    const bySuit: Record<string, string[]> = { m: [], p: [], s: [], z: [] };
    for (const tile of tiles) bySuit[tile[1]!]?.push(tile[0]!);
    let result = "";
    for (const suit of ["m", "p", "s", "z"]) {
      const numbers = bySuit[suit]!;
      if (numbers.length > 0) result += numbers.sort().join("") + suit;
    }
    return result;
  }

  /**
   * 副露を riichi 表記にする。
   * 暗槓は 2 枚表記（"55z"）、明刻・順子は 3 枚、明槓（大明槓・加槓）は 4 枚で表す（riichi の仕様）
   */
  private static formatMelds(melds: Meld[]): string {
    let result = "";
    for (const meld of melds) {
      const tiles =
        meld.type === "ANKAN" ? meld.consumed.slice(0, 2) : [...meld.consumed, meld.tile];
      result += `+${this.formatTiles(tiles)}`;
    }
    return result;
  }

  private static doraTiles(context: WinContext): Tile[] {
    const indicators = [...context.doraIndicators, ...(context.uraDoraIndicators ?? [])];
    return indicators.map(nextDoraTile);
  }

  private static extraFlags(context: WinContext, isTsumo: boolean): string {
    let flags = "";
    if (context.doubleRiichi) flags += "w";
    else if (context.riichi) flags += "r";
    if (context.ippatsu) flags += "i";
    if (isTsumo ? context.haitei : context.houtei) flags += "h";
    if (isTsumo ? context.rinshan : context.chankan) flags += "k";
    if (isTsumo && (context.tenhou || context.chiihou)) flags += "t";
    return `${flags}${context.roundWind}${context.seatWind}`;
  }

  /**
   * 役と点数を計算する
   * @param hand 和了者の手牌（副露を除く。和了牌を含む 14, 11, 8, 5, 2 枚）
   * @param melds 和了者の副露
   * @param winTile 和了牌（hand に含まれていること）
   * @param isTsumo 自摸和了か
   * @param context 場風・自風・ドラ・状況役
   */
  public static evaluate(
    hand: Tile[],
    melds: Meld[],
    winTile: Tile,
    isTsumo: boolean,
    context: WinContext,
  ): EvaluatedHand {
    const rest = [...hand];
    const winIndex = rest.indexOf(winTile);
    if (winIndex < 0) return NO_WIN;
    rest.splice(winIndex, 1);

    let query = this.formatTiles(rest);
    if (isTsumo) query += winTile;
    query += this.formatMelds(melds);
    if (!isTsumo) query += `+${winTile}`;
    const dora = this.doraTiles(context);
    if (dora.length > 0) query += `+d${this.formatTiles(dora)}`;
    query += `+${this.extraFlags(context, isTsumo)}`;

    const cacheKey = `${query}|${context.akaDora === false ? "noaka" : "aka"}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    let evaluated: EvaluatedHand;
    try {
      const riichi = new Riichi(query);
      riichi.disableHairi();
      if (context.akaDora === false) riichi.disableAka();
      const result = riichi.calc();
      const yaku = result.yaku ?? {};
      const doraHan = ["ドラ", "赤ドラ"].reduce(
        (sum, name) => sum + (yaku[name] ? Number.parseInt(yaku[name]!, 10) || 0 : 0),
        0,
      );
      const isCompleteShape = Boolean(result.isAgari) && !result.error;
      evaluated = {
        isAgari: isCompleteShape && result.ten > 0,
        isCompleteShape,
        yaku,
        yakuman: result.yakuman ?? 0,
        han: result.han ?? 0,
        fu: result.fu ?? 0,
        ten: result.ten ?? 0,
        oya: result.oya ?? [0, 0, 0],
        ko: result.ko ?? [0, 0, 0],
        text: result.text ?? "",
        dora: doraHan,
      };
    } catch {
      evaluated = { ...NO_WIN, text: "Error" };
    }

    if (this.cache.size >= CACHE_LIMIT) this.cache.clear();
    this.cache.set(cacheKey, evaluated);
    return evaluated;
  }
}
