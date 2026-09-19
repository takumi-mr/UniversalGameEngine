import type { MahjongAction, MahjongState } from "@engine/shared/rules/mahjong/MahjongRuleset";
import { defineSoundProfile, normalizeCues, type SoundCue } from "@/sound/types";
import {
  mahjongActionCues,
  mahjongBgm,
  mahjongBgmFor,
  mahjongSounds,
  mahjongStateCues,
} from "@/sound/profiles/createMahjongSoundProfile";

// リーチ麻雀 1 局戦
export default defineSoundProfile<MahjongState, MahjongAction>({
  se: mahjongSounds,
  bgm: mahjongBgm,
  onAction: (action) => mahjongActionCues(action),
  onStateChange(prev, next) {
    const cues: SoundCue[] = [];
    if (prev.status === "WAITING" && next.status === "PLAYING") cues.push("deal");
    cues.push(...normalizeCues(mahjongStateCues(prev, next)));
    return cues;
  },
  bgmFor: mahjongBgmFor,
});
