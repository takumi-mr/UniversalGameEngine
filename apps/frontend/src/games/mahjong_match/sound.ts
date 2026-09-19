import type {
  MahjongMatchAction,
  MahjongMatchState,
} from "@engine/shared/rules/mahjong/MahjongMatchRuleset";
import type { MahjongAction, MahjongState } from "@engine/shared/rules/mahjong/MahjongRuleset";
import { defineSoundProfile, type SoundCue } from "@/sound/types";
import {
  mahjongActionCues,
  mahjongBgm,
  mahjongBgmFor,
  mahjongSounds,
  mahjongStateCues,
} from "@/sound/profiles/createMahjongSoundProfile";

// 東風戦・半荘戦。現在局（currentGame.state）と SUBGAME_ACTION の中身を 1 局戦の判定に渡す。
// currentGame.state は BaseGameState として届くので、麻雀の型に戻して読む
const hand = (state: MahjongMatchState) => state.currentGame.state as MahjongState;

export default defineSoundProfile<MahjongMatchState, MahjongMatchAction>({
  se: mahjongSounds,
  bgm: mahjongBgm,
  onAction(action) {
    if (action.type !== "SUBGAME_ACTION") return;
    return mahjongActionCues(action.subAction as MahjongAction);
  },
  onStateChange(prev, next) {
    if (prev.status === "WAITING" && next.status === "PLAYING") return "deal";
    // 局が終わると同じ reduce の中で次局が配られる（currentGame は新しい局、結果は lastResult に移る）
    if (next.completedGames > prev.completedGames) {
      const cues: SoundCue[] = [];
      if (next.lastResult && next.lastResult.type !== "WIN") cues.push("ryukyoku");
      // 結果表示と重ならないよう少し置いて配牌音
      if (next.status === "PLAYING") cues.push({ key: "deal", delayMs: 1200 });
      return cues;
    }
    return mahjongStateCues(hand(prev), hand(next));
  },
  bgmFor(state, ctx) {
    if (state.status !== "PLAYING") return null;
    return mahjongBgmFor(hand(state), ctx);
  },
});
