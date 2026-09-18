import { describe, expect, test } from "bun:test";
import "@engine/shared/GameRegistry";
import { UniversalEngine } from "@engine/shared/UniversalEngine";
import { MahjongRuleset, type MahjongState } from "@engine/shared/rules/mahjong/MahjongRuleset";
import {
  MahjongMatchRuleset,
  type MahjongMatchState,
} from "@engine/shared/rules/mahjong/MahjongMatchRuleset";
import { MersenneTwisterRNG } from "@engine/shared/utils/MersenneTwisterRNG";

const PLAYERS = ["p1", "p2", "p3", "p4"];

/** 1 局の不変条件: 牌は 136 枚のまま、手牌の枚数は副露と手番に整合し、点数は供託を含めて保存される */
function checkHandInvariants(hand: MahjongState, totalScore: number): void {
  const tiles = [
    ...hand.wall.value,
    ...hand.deadWall.value,
    ...PLAYERS.flatMap((id) => hand.hands[id]!.value),
    ...PLAYERS.flatMap((id) => hand.discards[id] ?? []),
    // 鳴いた牌（meld.tile）は河に残したままなので、手牌から出した consumed だけを数える
    ...PLAYERS.flatMap((id) => (hand.melds[id] ?? []).flatMap((m) => m.consumed)),
    ...(hand.pendingKan ? [hand.pendingKan.tile] : []),
  ];
  // 栄和では和了牌を和了者の手牌にも加えて公開するので、その分は重複する
  const ronWinners = (hand.result?.winners ?? []).filter((w) => !w.isTsumo).length;
  // 王牌の嶺上牌は位置固定のまま rinshanDrawn 枚が手牌に移っている
  expect(tiles).toHaveLength(136 + ronWinners + hand.rinshanDrawn);

  const scoreSum = PLAYERS.reduce((sum, id) => sum + hand.scores[id]!, 0);
  expect(scoreSum + hand.riichiSticks * 1_000).toBe(totalScore);

  if (hand.status !== "PLAYING") return;
  for (const id of PLAYERS) {
    const size = 13 - (hand.melds[id]?.length ?? 0) * 3;
    const length = hand.hands[id]!.value.length;
    const isTurn = hand.phase === "PLAYING" && hand.activePlayers?.includes(id);
    const isKanCaller = hand.pendingKan?.playerId === id;
    expect(length === size || ((isTurn || isKanCaller) && length === size + 1)).toBe(true);
  }
  if (hand.phase === "INTERRUPTING") expect(hand.activePlayers!.length).toBeGreaterThan(0);
  if (hand.phase === "PLAYING") expect(hand.activePlayers).toHaveLength(1);
}

function playRandom(seed: number): MahjongMatchState {
  const engine = new UniversalEngine(MahjongMatchRuleset, {
    playerIds: PLAYERS,
    mode: "TONPU",
    serverSeed: `playout-${seed}`,
    clientSeed: "mahjong",
  });
  const picker = new MersenneTwisterRNG(seed);
  for (let step = 0; step < 5_000; step++) {
    const state = engine.getState();
    if (state.status !== "PLAYING") break;
    const hand = state.currentGame.state as MahjongState;
    checkHandInvariants(hand, 100_000);
    const playerId = state.activePlayers![picker.nextInt(0, state.activePlayers!.length - 1)]!;
    const actions = engine.getLegalActions(playerId);
    expect(actions.length).toBeGreaterThan(0);
    const action = actions[picker.nextInt(0, actions.length - 1)]!;
    expect(engine.dispatch({ ...action, timestamp: step })).toBe(true);
  }
  return engine.getState();
}

describe("Mahjong random playout", () => {
  test("ランダムな合法手で東風戦を最後まで進められ、不変条件を満たす", () => {
    let finished = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const state = playRandom(seed);
      if (state.status === "FINISHED") finished++;
      expect(state.completedGames).toBeGreaterThan(0);
      const sum = PLAYERS.reduce((total, id) => total + state.scores[id]!, 0);
      expect(sum + state.riichiSticks * 1_000).toBe(100_000);
    }
    expect(finished).toBeGreaterThan(0);
  });

  test("1 局のルールセット単体でもランダムに終局する", () => {
    for (let seed = 1; seed <= 6; seed++) {
      const engine = new UniversalEngine(MahjongRuleset, {
        serverSeed: `hand-${seed}`,
        clientSeed: "mahjong",
      });
      for (const playerId of PLAYERS) engine.dispatch({ type: "JOIN", playerId });
      expect(engine.dispatch({ type: "START", playerId: "p1" })).toBe(true);
      const picker = new MersenneTwisterRNG(seed);
      for (let step = 0; step < 1_000 && engine.getState().status === "PLAYING"; step++) {
        const state = engine.getState();
        checkHandInvariants(state, 100_000);
        const playerId = state.activePlayers![picker.nextInt(0, state.activePlayers!.length - 1)]!;
        const actions = engine.getLegalActions(playerId);
        const action = actions[picker.nextInt(0, actions.length - 1)]!;
        expect(engine.dispatch({ ...action, timestamp: step })).toBe(true);
      }
      const state = engine.getState();
      expect(state.status).toBe("FINISHED");
      expect(state.result).toBeDefined();
    }
  });
});
