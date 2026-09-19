// apps/frontend/src/sound/profiles/createMahjongSoundProfile.ts
//
// リーチ麻雀のサウンド定義。1 局戦（mahjong）と半荘戦（mahjong_match、局を SUBGAME_ACTION で包む）で共有する。
// 音の判定はアクション種別が主で、アクションからは分からない結果（流局）だけ状態差分で拾う。
import type { MahjongAction, MahjongState } from "@engine/shared/rules/mahjong/MahjongRuleset";
import type { SoundAssetDef, BgmDef, SoundContext, SoundCue, SoundCues } from "@/sound/types";

const BASE_URL = "/sounds/mahjong";

export const mahjongSounds: Record<string, SoundAssetDef> = {
  deal: { src: `${BASE_URL}/deal.mp3`, cooldownMs: 500 },
  discard: { src: `${BASE_URL}/discard.mp3`, cooldownMs: 40 },
  riichi: { src: `${BASE_URL}/riichi.mp3` },
  chi: { src: `${BASE_URL}/chi.mp3` },
  pon: { src: `${BASE_URL}/pon.mp3` },
  kan: { src: `${BASE_URL}/kan.mp3` },
  tsumo: { src: `${BASE_URL}/tsumo.mp3` },
  ron: { src: `${BASE_URL}/ron.mp3` },
  ryukyoku: { src: `${BASE_URL}/ryukyoku.mp3` },
};

export const mahjongBgm: Record<string, BgmDef> = {
  main: { src: `${BASE_URL}/bgm_main.mp3`, loop: true },
};

/** 1 局分のアクションから鳴らす音 */
export function mahjongActionCues(action: MahjongAction): SoundCues {
  switch (action.type) {
    case "DISCARD":
      return "discard";
    case "RIICHI":
      // 立直宣言 → 少し遅れて打牌音
      return ["riichi", { key: "discard", delayMs: 120 }];
    case "CALL":
      return action.meldType === "CHI" ? "chi" : action.meldType === "PON" ? "pon" : "kan";
    case "ANKAN":
    case "KAKAN":
      return "kan";
    case "TSUMO":
      return "tsumo";
    case "RON":
      return "ron";
    case "KYUUSHU_KYUUHAI":
      return "ryukyoku";
    default:
      return;
  }
}

/** 1 局分の状態差分から鳴らす音（アクションからは分からない流局） */
export function mahjongStateCues(prev: MahjongState, next: MahjongState): SoundCues {
  const cues: SoundCue[] = [];
  if (!prev.result && next.result && next.result.type !== "WIN") cues.push("ryukyoku");
  return cues;
}

export function mahjongBgmFor(state: MahjongState, ctx: SoundContext): string | null {
  if (ctx.mode !== "live") return null;
  return state.phase === "PLAYING" || state.phase === "INTERRUPTING" ? "main" : null;
}
