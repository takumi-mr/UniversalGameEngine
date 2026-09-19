import { describe, it, expect } from "vitest";
import type { MahjongAction, MahjongState } from "@engine/shared/rules/mahjong/MahjongRuleset";
import type { MahjongMatchState } from "@engine/shared/rules/mahjong/MahjongMatchRuleset";
import mahjongSound from "@/games/mahjong/sound";
import mahjongMatchSound from "@/games/mahjong_match/sound";
import { mahjongActionCues } from "@/sound/profiles/createMahjongSoundProfile";
import { normalizeCues, type SoundContext } from "@/sound/types";

const ctx: SoundContext = { myPlayerId: "p1", mode: "live" };
const keysOf = (cues: ReturnType<typeof mahjongActionCues>) =>
  normalizeCues(cues).map((c) => c.key);

// 音の判定に使うフィールドだけを持つ最小の局状態
const hand = (over: Partial<MahjongState> = {}): MahjongState =>
  ({ status: "PLAYING", phase: "PLAYING", ...over }) as MahjongState;

describe("mahjong action → sound", () => {
  it.each<[MahjongAction, string[]]>([
    [{ type: "DISCARD", tile: "1m" }, ["discard"]],
    [{ type: "RIICHI", tile: "1m" }, ["riichi", "discard"]],
    [{ type: "CALL", meldType: "CHI" }, ["chi"]],
    [{ type: "CALL", meldType: "PON" }, ["pon"]],
    [{ type: "CALL", meldType: "KAN" }, ["kan"]],
    [{ type: "ANKAN", tile: "1m" }, ["kan"]],
    [{ type: "KAKAN", tile: "1m" }, ["kan"]],
    [{ type: "TSUMO" }, ["tsumo"]],
    [{ type: "RON" }, ["ron"]],
    [{ type: "KYUUSHU_KYUUHAI" }, ["ryukyoku"]],
    [{ type: "PASS" }, []],
    [{ type: "START" }, []],
  ])("%o", (action, expected) => {
    expect(keysOf(mahjongActionCues(action))).toEqual(expected);
  });
});

describe("mahjong (1 局戦) profile", () => {
  it("開始で配牌音、流局は状態差分で拾う", () => {
    const waiting = hand({ status: "WAITING", phase: "WAITING" });
    expect(keysOf(mahjongSound.onStateChange!(waiting, hand(), ctx))).toEqual(["deal"]);

    const draw = hand({
      status: "FINISHED",
      phase: "FINISHED",
      result: { type: "EXHAUSTIVE_DRAW", winners: [], tenpai: [], scoreDeltas: {}, renchan: true },
    });
    expect(keysOf(mahjongSound.onStateChange!(hand(), draw, ctx))).toEqual(["ryukyoku"]);
    // 和了は RON / TSUMO のアクション音に任せる
    const win = hand({
      status: "FINISHED",
      phase: "FINISHED",
      result: { type: "WIN", winners: [], tenpai: [], scoreDeltas: {}, renchan: false },
    });
    expect(keysOf(mahjongSound.onStateChange!(hand(), win, ctx))).toEqual([]);
  });

  it("BGM は局の進行中（PLAYING / INTERRUPTING）だけ、リプレイでは流さない", () => {
    expect(mahjongSound.bgmFor!(hand(), ctx)).toBe("main");
    expect(mahjongSound.bgmFor!(hand({ phase: "INTERRUPTING" }), ctx)).toBe("main");
    expect(mahjongSound.bgmFor!(hand({ phase: "FINISHED" }), ctx)).toBeNull();
    expect(mahjongSound.bgmFor!(hand(), { ...ctx, mode: "replay" })).toBeNull();
  });
});

describe("mahjong_match (半荘戦) profile", () => {
  const match = (over: Partial<MahjongMatchState> = {}, handOver: Partial<MahjongState> = {}) =>
    ({
      status: "PLAYING",
      currentGameId: "hand-1",
      completedGames: 0,
      currentGame: { type: "mahjong", state: hand(handOver) },
      ...over,
    }) as MahjongMatchState;

  it("SUBGAME_ACTION の中身で音を決める", () => {
    const prev = match();
    const next = match();
    const discard: MahjongAction = { type: "DISCARD", tile: "1m" };
    const cues = mahjongMatchSound.onAction!(
      { type: "SUBGAME_ACTION", subAction: discard },
      prev,
      next,
      ctx,
    );
    expect(normalizeCues(cues).map((c) => c.key)).toEqual(["discard"]);
    expect(normalizeCues(mahjongMatchSound.onAction!({ type: "START" }, prev, next, ctx))).toEqual(
      [],
    );
  });

  it("局が進んだら流局なら ryukyoku、続けて次局の配牌音（遅延付き）", () => {
    const prev = match();
    const next = match({
      currentGameId: "hand-2",
      completedGames: 1,
      lastResult: {
        type: "EXHAUSTIVE_DRAW",
        winners: [],
        tenpai: [],
        scoreDeltas: {},
        renchan: true,
      },
    });
    const cues = normalizeCues(mahjongMatchSound.onStateChange!(prev, next, ctx));
    expect(cues.map((c) => c.key)).toEqual(["ryukyoku", "deal"]);
    expect(cues[1].delayMs).toBeGreaterThan(0);

    // 和了で局が進んだときは配牌音だけ（和了音はアクション側）
    const won = match({
      currentGameId: "hand-2",
      completedGames: 1,
      lastResult: { type: "WIN", winners: [], tenpai: [], scoreDeltas: {}, renchan: false },
    });
    expect(
      normalizeCues(mahjongMatchSound.onStateChange!(prev, won, ctx)).map((c) => c.key),
    ).toEqual(["deal"]);

    // 対局そのものが終わったら配牌音は鳴らさない
    const finished = match({ status: "FINISHED", completedGames: 1, lastResult: won.lastResult });
    expect(
      normalizeCues(mahjongMatchSound.onStateChange!(prev, finished, ctx)).map((c) => c.key),
    ).toEqual([]);
  });

  it("BGM は対局中かつ局の進行中だけ", () => {
    expect(mahjongMatchSound.bgmFor!(match(), ctx)).toBe("main");
    expect(mahjongMatchSound.bgmFor!(match({ status: "FINISHED" }), ctx)).toBeNull();
    expect(mahjongMatchSound.bgmFor!(match({}, { phase: "FINISHED" }), ctx)).toBeNull();
  });
});
