import { describe, it, expect } from "vitest";
import type { BaseGameState } from "@engine/shared/GameRules";
import { CommonSound, deriveCommonCues } from "@/sound/common";
import type { SoundContext } from "@/sound/types";

const base = (over: Partial<BaseGameState> = {}): BaseGameState => ({
  status: "PLAYING",
  players: { "1": "me", "-1": "you" },
  activePlayers: ["you"],
  version: 1,
  ...over,
});

const me: SoundContext = { myPlayerId: "me", mode: "live" };
const spectator: SoundContext = { myPlayerId: "SPECTATOR", mode: "replay" };

// checkWinCondition だけを差し替えられる最小のルールセット
const rulesetWith = (winnerIds: string[] | undefined) => ({
  checkWinCondition: () => ({ isFinished: true, winnerIds }),
});

describe("deriveCommonCues", () => {
  it("WAITING → PLAYING で開始音", () => {
    const cues = deriveCommonCues(base({ status: "WAITING", activePlayers: [] }), base(), me);
    expect(cues).toContain(CommonSound.GAME_START);
  });

  it("自分の手番が回ってきたときだけ手番音（観戦者には鳴らさない）", () => {
    const prev = base({ activePlayers: ["you"] });
    const next = base({ activePlayers: ["me"], version: 2 });
    expect(deriveCommonCues(prev, next, me)).toEqual([CommonSound.MY_TURN]);
    // 手番が続いている間は鳴らさない
    expect(deriveCommonCues(next, base({ activePlayers: ["me"], version: 3 }), me)).toEqual([]);
    expect(deriveCommonCues(prev, next, spectator)).toEqual([]);
  });

  it("終局時は勝敗に応じて victory / defeat / draw、観戦者は game_end", () => {
    const prev = base();
    const next = base({ status: "FINISHED", activePlayers: [], version: 2 });
    expect(deriveCommonCues(prev, next, me, rulesetWith(["me"]))).toEqual([CommonSound.VICTORY]);
    expect(deriveCommonCues(prev, next, me, rulesetWith(["you"]))).toEqual([CommonSound.DEFEAT]);
    expect(deriveCommonCues(prev, next, me, rulesetWith([]))).toEqual([CommonSound.DRAW]);
    expect(deriveCommonCues(prev, next, spectator, rulesetWith(["me"]))).toEqual([
      CommonSound.GAME_END,
    ]);
    // ルールセットが無ければ勝敗を判定できないので game_end
    expect(deriveCommonCues(prev, next, me)).toEqual([CommonSound.GAME_END]);
  });

  it("終局と同時に手番が自分に来ても手番音は鳴らさない", () => {
    const prev = base({ activePlayers: ["you"] });
    const next = base({ status: "FINISHED", activePlayers: ["me"], version: 2 });
    expect(deriveCommonCues(prev, next, me, rulesetWith(["me"]))).toEqual([CommonSound.VICTORY]);
  });

  it("checkWinCondition が例外を投げても game_end にフォールバックする", () => {
    const prev = base();
    const next = base({ status: "FINISHED", version: 2 });
    const broken = {
      checkWinCondition: () => {
        throw new Error("boom");
      },
    };
    expect(deriveCommonCues(prev, next, me, broken)).toEqual([CommonSound.GAME_END]);
  });
});
