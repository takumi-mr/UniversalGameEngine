// packages/shared/rules/__tests__/HanafudaRuleset.test.ts
import { describe, it, expect } from "bun:test";
import { UniversalEngine } from "@engine/shared/UniversalEngine";
import type { Masked } from "@engine/shared/GameRules";
import {
  HanafudaRuleset,
  type HanafudaState,
  type HanafudaAction,
} from "@engine/shared/rules/HanafudaRuleset";

type Engine = UniversalEngine<HanafudaState, HanafudaAction>;
const [A, B] = ["alice", "bob"];

function started(seed = "hanafuda"): Engine {
  const engine = new UniversalEngine<HanafudaState, HanafudaAction>(HanafudaRuleset, {
    clientSeed: seed,
    serverSeed: seed,
  });
  expect(engine.dispatch({ type: "JOIN", playerId: A })).toBe(true);
  expect(engine.dispatch({ type: "JOIN", playerId: B })).toBe(true);
  expect(engine.dispatch({ type: "START", playerId: A })).toBe(true);
  return engine;
}

const S = (e: Engine) => e.getState();
const masked = (e: Engine, playerId: string) =>
  e.getMaskedState(playerId) as unknown as Masked<HanafudaState>;

describe("HanafudaRuleset", () => {
  it("初期状態は空席で、配札されていない", () => {
    const s = HanafudaRuleset.getInitialState();
    expect(s.status).toBe("WAITING");
    expect(s.players).toEqual({ "1": null, "2": null });
    expect(s.playerIds).toEqual([]);
    expect(s.hands).toEqual({});
  });

  it("2 人揃うまで START できない", () => {
    const engine = new UniversalEngine<HanafudaState, HanafudaAction>(HanafudaRuleset, {});
    engine.dispatch({ type: "JOIN", playerId: A });
    expect(HanafudaRuleset.isValidAction(S(engine), { type: "START", playerId: A })).toBe(false);
    engine.dispatch({ type: "JOIN", playerId: B });
    expect(HanafudaRuleset.isValidAction(S(engine), { type: "START", playerId: A })).toBe(true);
  });

  it("START で着席順に配札され、スロット 1 が親になる", () => {
    const s = S(started());
    expect(s.status).toBe("PLAYING");
    expect(s.playerIds).toEqual([A, B]);
    expect(s.activePlayers).toEqual([A]);
    expect(s.phase).toBe("PLAY_HAND");
    expect(s.hands[A].value).toHaveLength(8);
    expect(s.hands[B].value).toHaveLength(8);
    expect(s.field).toHaveLength(8);
    expect(s.deck.value).toHaveLength(48 - 24);
    expect(s.captured).toEqual({ [A]: [], [B]: [] });
  });

  it("手札は本人にだけ見え、相手には伏せられる", () => {
    const engine = started();
    const viewA = masked(engine, A);
    expect(viewA.hands[A]).toEqual(S(engine).hands[A].value);
    expect(viewA.hands[B]).toEqual(Array(8).fill("?"));
    expect(viewA.deck).toEqual(Array(24).fill("?"));
  });

  it("親が手札を出すと DRAW_DECK になり、山札をめくると子の番になる", () => {
    const engine = started();
    const card = S(engine).hands[A].value[0];
    expect(engine.dispatch({ type: "PLAY_CARD", playerId: A, card })).toBe(true);
    expect(S(engine).hands[A].value).not.toContain(card);

    // 場に同月の札が 2 枚あった場合は選択フェーズを挟む
    if (S(engine).phase === "CHOOSE_HAND_MATCH") {
      const pick = S(engine).matchingOptions![0];
      expect(engine.dispatch({ type: "CHOOSE_MATCH", playerId: A, card: pick })).toBe(true);
    }
    expect(S(engine).phase).toBe("DRAW_DECK");
    expect(engine.dispatch({ type: "DRAW_DECK", playerId: A })).toBe(true);

    if (S(engine).phase === "CHOOSE_DECK_MATCH") {
      const pick = S(engine).matchingOptions![0];
      expect(engine.dispatch({ type: "CHOOSE_MATCH", playerId: A, card: pick })).toBe(true);
    }
    // 役ができていなければ手番交代
    if (S(engine).phase !== "KOIKOI_OR_STOP") {
      expect(S(engine).activePlayers).toEqual([B]);
      expect(S(engine).phase).toBe("PLAY_HAND");
    }
  });

  it("手番でないプレイヤーの着手は拒否される", () => {
    const engine = started();
    const card = S(engine).hands[B].value[0];
    expect(engine.dispatch({ type: "PLAY_CARD", playerId: B, card })).toBe(false);
  });

  it("options.playerIds で最初から着席済みにできる", () => {
    const engine = new UniversalEngine<HanafudaState, HanafudaAction>(HanafudaRuleset, {
      playerIds: [A, B],
    });
    expect(S(engine).players).toEqual({ "1": A, "2": B });
    expect(engine.dispatch({ type: "START", playerId: A })).toBe(true);
    expect(S(engine).playerIds).toEqual([A, B]);
  });
});
