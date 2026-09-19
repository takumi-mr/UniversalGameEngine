import { describe, it, expect } from "vitest";
import { OthelloRuleset, type OthelloAction } from "@engine/shared/rules/OthelloRuleset";
import { withTestRng } from "@engine/shared/testing/withTestRng";
import othelloSound from "@/games/othello/sound";
import { countFlipped } from "@/sound/profiles/createOthelloSoundProfile";
import { normalizeCues, type SoundContext } from "@/sound/types";

const rules = withTestRng(OthelloRuleset);
const ctx: SoundContext = { myPlayerId: "black", mode: "live" };

// 8x8 の初期配置から黒が (2,3) に置くと白 (3,3) が 1 枚裏返る
function started() {
  const state = rules.getInitialState();
  state.status = "PLAYING";
  state.players = { 1: "black", [-1]: "white" };
  state.activePlayers = ["black"];
  return state;
}
const place = (x: number, y: number): OthelloAction => ({
  type: "PLACE_PIECE",
  x,
  y,
  color: 1,
  playerId: "black",
});

describe("othello sound profile", () => {
  it("着手で place、裏返しがあれば遅延付きの flip", () => {
    const prev = started();
    const action = place(2, 3);
    const next = rules.reduce(prev, action);
    expect(countFlipped(prev, next)).toBe(1);
    const keys = normalizeCues(othelloSound.onAction!(action, prev, next, ctx));
    expect(keys.map((k) => k.key)).toEqual(["place", "flip"]);
    expect(keys[1].delayMs).toBeGreaterThan(0);
  });

  it("着手以外のアクション（投了）では鳴らさない（勝敗音は共通側）", () => {
    const prev = started();
    const action: OthelloAction = { type: "RESIGN", playerId: "black" };
    const next = rules.reduce(prev, action);
    expect(normalizeCues(othelloSound.onAction!(action, prev, next, ctx))).toEqual([]);
  });

  it("着手後も手番が戻ってきたら pass", () => {
    const prev = started();
    const action = place(2, 3);
    // 相手に合法手が無くパスになった状況を模す（手番が変わらない）
    const next = { ...rules.reduce(prev, action), currentTurn: prev.currentTurn };
    const keys = normalizeCues(othelloSound.onAction!(action, prev, next, ctx)).map((k) => k.key);
    expect(keys).toContain("pass");
  });

  it("BGM は対局中だけ", () => {
    const state = started();
    expect(othelloSound.bgmFor!(state, ctx)).toBe("main");
    expect(othelloSound.bgmFor!({ ...state, status: "FINISHED" }, ctx)).toBeNull();
  });
});
