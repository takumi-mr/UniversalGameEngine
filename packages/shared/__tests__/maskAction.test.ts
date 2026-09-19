// packages/shared/__tests__/maskAction.test.ts
// 配信メタ（「その更新を生んだアクション」）は部屋の全員に届くので、
// アクション自体に秘密を持つゲームは maskAction で閲覧者ごとに隠すことを検証する。
import { describe, it, expect } from "bun:test";
import { UniversalEngine } from "@engine/shared/UniversalEngine";
import { gameRegistry } from "@engine/shared/GameRegistry";
import { OthelloRuleset, type OthelloAction } from "@engine/shared/rules/OthelloRuleset";
import { WerewolfRuleset, type WerewolfAction } from "@engine/shared/rules/WerewolfRuleset";
import { CaveDiveRuleset, type CaveDiveAction } from "@engine/shared/rules/CaveDiveRuleset";
import {
  EquilibriumRuleset,
  type EquilibriumAction,
  type EquilibriumState,
} from "@engine/shared/rules/EquilibriumRuleset";
import { DecathlonRuleset, type DecathlonAction } from "@engine/shared/rules/DecathlonRuleset";

describe("UniversalEngine.getMaskedAction", () => {
  it("maskAction を持たないルールセットではアクションをそのまま返すこと", () => {
    const engine = new UniversalEngine(OthelloRuleset, {});
    const action: OthelloAction = { type: "PLACE_PIECE", x: 2, y: 3, playerId: "A" };
    expect(engine.getMaskedAction(action, "B")).toBe(action);
    expect(engine.getMaskedAction(action, "SPECTATOR")).toBe(action);
  });

  it("行動した本人にはそのまま届き、他人と観戦者には maskAction の結果が届くこと", () => {
    const engine = new UniversalEngine(CaveDiveRuleset, {});
    const action: CaveDiveAction = { type: "CHOOSE", playerId: "a", choice: "STAY" };
    expect(engine.getMaskedAction(action, "a")).toEqual(action);
    expect(engine.getMaskedAction(action, "b")).toEqual({ type: "CHOOSE", playerId: "a" });
    expect(engine.getMaskedAction(action, "SPECTATOR")).toEqual({ type: "CHOOSE", playerId: "a" });
  });
});

describe("maskAction per ruleset", () => {
  it("人狼: 夜の行動は本人以外に配信しない（誰が行動したかで役職が割れる）。投票は公開", () => {
    const state = new UniversalEngine(WerewolfRuleset, {
      playerIds: ["a", "b", "c", "d", "e"],
    }).getState();
    const night: WerewolfAction = { type: "NIGHT_ACTION", playerId: "a", target: "b" };
    expect(WerewolfRuleset.maskAction!(state, night, "b")).toBeNull();
    expect(WerewolfRuleset.maskAction!(state, night, "SPECTATOR")).toBeNull();

    const vote: WerewolfAction = { type: "VOTE", playerId: "a", target: "b" };
    expect(WerewolfRuleset.maskAction!(state, vote, "b")).toEqual(vote);
  });

  it("CaveDive: 同時秘密選択の中身（choice）は落とし、選んだ事実だけ残す", () => {
    const state = CaveDiveRuleset.getInitialState({});
    const choose: CaveDiveAction = {
      type: "CHOOSE",
      playerId: "a",
      choice: "LEAVE",
      timestamp: 123,
    };
    expect(CaveDiveRuleset.maskAction!(state, choose, "b")).toEqual({
      type: "CHOOSE",
      playerId: "a",
      timestamp: 123,
    });
    const torch: CaveDiveAction = { type: "TORCH", playerId: "a" };
    expect(CaveDiveRuleset.maskAction!(state, torch, "b")).toEqual(torch);
  });

  it("Equilibrium: 秘密の入札額と勝利条件の差し替え先は落とす", () => {
    const state = new UniversalEngine(EquilibriumRuleset, {
      playerIds: ["a", "b", "c"],
    }).getState();
    const bid: EquilibriumAction = { type: "BID", playerId: "a", amount: 3 };
    expect(EquilibriumRuleset.maskAction!(state, bid, "b")).toEqual({
      type: "BID",
      playerId: "a",
    } as EquilibriumAction);

    const alter: EquilibriumAction = { type: "ALTER_GOAL", playerId: "a", newGoalCardId: "g1" };
    expect(EquilibriumRuleset.maskAction!(state, alter, "b")).toEqual({
      type: "ALTER_GOAL",
      playerId: "a",
    } as EquilibriumAction);

    const play: EquilibriumAction = { type: "PLAY_CARD", playerId: "a", cardId: "c1" };
    expect(EquilibriumRuleset.maskAction!(state as EquilibriumState, play, "b")).toEqual(play);
  });

  it("Decathlon: 秘密の宣言は落とし、種目のアクションはその種目の maskAction に委ねる", () => {
    const base = DecathlonRuleset.getInitialState({ playerIds: ["a", "b"] });
    const declare: DecathlonAction = { type: "DECLARE", playerId: "a", declaration: "BOLD" };
    expect(DecathlonRuleset.maskAction!(base, declare, "b")).toEqual({
      type: "DECLARE",
      playerId: "a",
    });

    // 種目が CaveDive（CHOOSE に秘密がある）のとき
    const caveState = CaveDiveRuleset.getInitialState({});
    const inCave = {
      ...base,
      currentGame: "cave_dive",
      subGames: { b1: { type: "cave_dive", state: caveState } },
    };
    const sub: DecathlonAction = {
      type: "SUBGAME_ACTION",
      playerId: "a",
      subGameId: "b1",
      subAction: { type: "CHOOSE", playerId: "a", choice: "STAY" } as CaveDiveAction,
    };
    expect(DecathlonRuleset.maskAction!(inCave, sub, "b")).toEqual({
      type: "SUBGAME_ACTION",
      playerId: "a",
      subGameId: "b1",
      subAction: { type: "CHOOSE", playerId: "a" },
    });

    // 盤面が片付いた後（最後の 1 手）は中身ごと落とす
    const cleared = { ...inCave, subGames: {} };
    expect(DecathlonRuleset.maskAction!(cleared, sub, "b")).toEqual({
      type: "SUBGAME_ACTION",
      playerId: "a",
      subGameId: "b1",
    });

    // 秘密を持たない種目（Othello）はそのまま
    const othello = {
      ...base,
      currentGame: "othello",
      subGames: { b1: { type: "othello", state: OthelloRuleset.getInitialState({}) } },
    };
    const move: DecathlonAction = {
      type: "SUBGAME_ACTION",
      playerId: "a",
      subGameId: "b1",
      subAction: { type: "PLACE_PIECE", x: 2, y: 3, playerId: "a" } as OthelloAction,
    };
    expect(DecathlonRuleset.maskAction!(othello, move, "b")).toEqual(move);
  });

  it("秘密を持つアクションのあるゲームは maskAction を実装していること", () => {
    for (const type of ["werewolf", "cave_dive", "equilibrium", "decathlon"]) {
      expect(gameRegistry.getDefinition(type)!.ruleset.maskAction, type).toBeDefined();
    }
  });
});
