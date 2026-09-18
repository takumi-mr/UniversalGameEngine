import { describe, expect, test } from "bun:test";
import "@engine/shared/GameRegistry";
import {
  MahjongMatchRuleset,
  type MahjongMatchAction,
  type MahjongMatchOptions,
  type MahjongMatchState,
} from "@engine/shared/rules/mahjong/MahjongMatchRuleset";
import type { MahjongState, Tile } from "@engine/shared/rules/mahjong/MahjongRuleset";
import { ProvablyFairRNG } from "@engine/shared/utils/ProvablyFairRNG";
import { createSecret } from "@engine/shared/GameRules";

const players = ["p1", "p2", "p3", "p4"];
const rng = () => new ProvablyFairRNG("match-test", "mahjong", 0);

/** 何も鳴けず、聴牌にも遠い手 */
const JUNK: Tile[] = ["1m", "4m", "7m", "1p", "4p", "7p", "1s", "4s", "7s", "1z", "2z", "3z", "4z"];
/** 123m 456p 789s 11z 22z: 1z / 2z のシャンポン待ち */
const SHANPON_WAIT: Tile[] = [
  "1m",
  "2m",
  "3m",
  "4p",
  "5p",
  "6p",
  "7s",
  "8s",
  "9s",
  "1z",
  "1z",
  "2z",
  "2z",
];

function hand(state: MahjongMatchState): MahjongState {
  return state.currentGame.state as MahjongState;
}

function start(options: MahjongMatchOptions = {}): MahjongMatchState {
  return MahjongMatchRuleset.getInitialState({ playerIds: players, ...options }, rng());
}

/** 現在局の手牌・山・ドラを差し替える（親は 14 枚、他は 13 枚を渡す） */
function rig(
  state: MahjongMatchState,
  hands: Partial<Record<string, Tile[]>>,
  wall?: Tile[],
): MahjongMatchState {
  const current = hand(state);
  const rigged: MahjongState = {
    ...current,
    doraIndicators: ["8p"],
    deadWall: createSecret(["1s", "1s", "1s", "1s", ...Array<Tile>(10).fill("8p")], []),
    wall: wall ? createSecret(wall, []) : current.wall,
    hands: Object.fromEntries(players.map((id) => [id, createSecret(hands[id] ?? JUNK, [id])])),
  };
  return { ...state, currentGame: { ...state.currentGame, state: rigged } };
}

function sub(playerId: string, subAction: Record<string, unknown>): MahjongMatchAction {
  return { type: "SUBGAME_ACTION", playerId, subAction: { type: "PASS", ...subAction, playerId } };
}

function act(state: MahjongMatchState, action: MahjongMatchAction): MahjongMatchState {
  expect(MahjongMatchRuleset.isValidAction(state, action)).toBe(true);
  return MahjongMatchRuleset.reduce(state, action, rng());
}

function dealerId(state: MahjongMatchState): string {
  return state.playerIds[state.dealerIndex]!;
}

/** 親が自摸和了して局を終える */
function dealerTsumo(state: MahjongMatchState): MahjongMatchState {
  const dealer = dealerId(state);
  const rigged = rig(state, { [dealer]: [...SHANPON_WAIT, "2z"] });
  // 天和にならないよう一巡済みにする
  const current = hand(rigged);
  const withDiscard = {
    ...rigged,
    currentGame: {
      ...rigged.currentGame,
      state: { ...current, discards: { ...current.discards, [dealer]: ["9m"] } },
    },
  };
  return act(withDiscard, sub(dealer, { type: "TSUMO" }));
}

/** 親が 2z を切り、下家がロンして局を終える */
function nextPlayerRon(state: MahjongMatchState): MahjongMatchState {
  const dealer = dealerId(state);
  const winner = state.playerIds[(state.dealerIndex + 1) % 4]!;
  let next = rig(state, { [dealer]: [...JUNK, "2z"], [winner]: SHANPON_WAIT });
  next = act(next, sub(dealer, { type: "DISCARD", tile: "2z" }));
  return act(next, sub(winner, { type: "RON" }));
}

/** 親が最後の牌を切って荒牌流局にする。tenpai に挙げたプレイヤーだけが聴牌 */
function exhaustiveDraw(state: MahjongMatchState, tenpai: string[]): MahjongMatchState {
  const dealer = dealerId(state);
  const hands = Object.fromEntries(
    players.map((id) => [
      id,
      id === dealer
        ? [...(tenpai.includes(id) ? SHANPON_WAIT : JUNK), "9m"]
        : tenpai.includes(id)
          ? SHANPON_WAIT
          : JUNK,
    ]),
  );
  return act(rig(state, hands, []), sub(dealer, { type: "DISCARD", tile: "9m" }));
}

/** 持ち越しの供託を置く */
function withSticks(state: MahjongMatchState, sticks: number): MahjongMatchState {
  const current: MahjongState = { ...hand(state), riichiSticks: sticks };
  return {
    ...state,
    riichiSticks: sticks,
    currentGame: { ...state.currentGame, state: current },
  };
}

describe("MahjongMatchRuleset", () => {
  test("東風戦を東1局 0 本場、起家 p1 の親で開始する", () => {
    const state = start({ mode: "TONPU" });

    expect(state.status).toBe("PLAYING");
    expect(state.mode).toBe("TONPU");
    expect(state.currentGameId).toBe("hand-1");
    expect(state.currentGame.type).toBe("mahjong");
    expect(state.wind).toBe("EAST");
    expect(state.round).toBe(1);
    expect(state.dealerIndex).toBe(0);
    expect(state.honba).toBe(0);
    expect(hand(state).wind).toBe("EAST");
    expect(hand(state).round).toBe(1);
    expect(hand(state).dealerIndex).toBe(0);
    expect(state.scores).toEqual({ p1: 25_000, p2: 25_000, p3: 25_000, p4: 25_000 });
    expect(state.activePlayers).toEqual(["p1"]);
    expect(hand(state).hands.p1.value).toHaveLength(14);
  });

  test("初期点数を指定できる", () => {
    const state = start({
      mode: "HANCHAN",
      initialScores: { p1: 30_000, p2: 25_000, p3: 25_000, p4: 20_000 },
    });
    expect(state.mode).toBe("HANCHAN");
    expect(hand(state).scores).toEqual({ p1: 30_000, p2: 25_000, p3: 25_000, p4: 20_000 });
  });

  test("対局の合法手は現在局へ委譲され、締切も引き継ぐ", () => {
    const state = start();
    const actions = MahjongMatchRuleset.getLegalActions(state, "p1");
    expect(actions.length).toBeGreaterThan(0);
    expect(actions.every((a) => a.type === "SUBGAME_ACTION" && a.playerId === "p1")).toBe(true);
    expect(actions.every((a) => MahjongMatchRuleset.isValidAction(state, a))).toBe(true);
    expect(MahjongMatchRuleset.getLegalActions(state, "p2")).toEqual([]);

    // 鳴ける打牌で割り込み待ちになると、対局の締切にも反映される
    let next = rig(state, {
      p1: [...JUNK, "5s"],
      p3: ["5s", "5s", "1m", "2m", "3m", "4m", "6m", "7m", "8m", "1p", "2p", "3p", "1z"],
    });
    next = act(next, { ...sub("p1", { type: "DISCARD", tile: "5s" }), timestamp: 1_000 });
    expect(hand(next).phase).toBe("INTERRUPTING");
    expect(next.activePlayers).toEqual(["p3"]);
    expect(next.turnDeadline).toBe(11_000);
    expect(MahjongMatchRuleset.getTimeoutAction!(next, "p3")).toEqual({
      type: "SUBGAME_ACTION",
      playerId: "p3",
      subAction: { type: "PASS", playerId: "p3" },
    });
    next = act(next, sub("p3", { type: "PASS" }));
    expect(next.turnDeadline).toBeUndefined();
  });

  test("親が和了すると連荘して本場が増え、子が和了すると親が流れて本場は 0 に戻る", () => {
    let state = start();
    state = dealerTsumo(state);
    expect(state.status).toBe("PLAYING");
    expect(state.completedGames).toBe(1);
    expect(state.currentGameId).toBe("hand-2");
    expect(state.wind).toBe("EAST");
    expect(state.round).toBe(1);
    expect(state.dealerIndex).toBe(0);
    expect(state.honba).toBe(1);
    expect(state.lastResult?.type).toBe("WIN");
    expect(state.scores.p1).toBe(25_000 + 2_100);
    expect(hand(state).honba).toBe(1);
    expect(hand(state).dealerIndex).toBe(0);
    expect(state.activePlayers).toEqual(["p1"]);

    state = nextPlayerRon(state);
    expect(state.round).toBe(2);
    expect(state.dealerIndex).toBe(1);
    expect(state.honba).toBe(0);
    // 1 本場のロン: 1300 + 300
    expect(state.scores.p2).toBe(25_000 - 700 + 1_300 + 300);
    expect(state.activePlayers).toEqual(["p2"]);
    expect(hand(state).hands.p2.value).toHaveLength(14);
    expect(state.scores.p1).toBe(25_000 + 2_100 - 1_300 - 300);
    expect(state.ranking).toEqual(["p2", "p1", "p3", "p4"]);
  });

  test("荒牌流局は本場を積み、親が聴牌なら連荘・ノーテンなら親が流れる。供託は持ち越す", () => {
    let state = withSticks(start(), 1);
    state = exhaustiveDraw(state, ["p1"]);
    expect(state.lastResult?.type).toBe("EXHAUSTIVE_DRAW");
    expect(state.lastResult?.renchan).toBe(true);
    expect(state.round).toBe(1);
    expect(state.honba).toBe(1);
    expect(state.riichiSticks).toBe(1);
    expect(hand(state).riichiSticks).toBe(1);
    expect(state.scores.p1).toBe(25_000 + 3_000);
    expect(state.scores.p2).toBe(24_000);

    state = exhaustiveDraw(state, []);
    expect(state.lastResult?.renchan).toBe(false);
    expect(state.round).toBe(2);
    expect(state.dealerIndex).toBe(1);
    expect(state.honba).toBe(2);
    expect(state.riichiSticks).toBe(1);

    // 次に和了した人が供託と本場を受け取る
    state = nextPlayerRon(state);
    expect(state.scores.p3).toBe(25_000 - 1_000 + 1_300 + 600 + 1_000);
    expect(state.riichiSticks).toBe(0);
  });

  test("東風戦は東4局で親が流れると終了し、半荘戦は南場へ進む", () => {
    let tonpu = start({ mode: "TONPU" });
    for (let i = 0; i < 3; i++) tonpu = nextPlayerRon(tonpu);
    expect(tonpu.wind).toBe("EAST");
    expect(tonpu.round).toBe(4);
    expect(tonpu.dealerIndex).toBe(3);
    tonpu = nextPlayerRon(tonpu);
    expect(tonpu.status).toBe("FINISHED");
    expect(tonpu.completedGames).toBe(4);
    expect(MahjongMatchRuleset.checkWinCondition(tonpu).winnerIds).toEqual([tonpu.ranking[0]!]);
    expect(MahjongMatchRuleset.getLegalActions(tonpu, "p1")).toEqual([]);

    let hanchan = start({ mode: "HANCHAN" });
    for (let i = 0; i < 4; i++) hanchan = nextPlayerRon(hanchan);
    expect(hanchan.status).toBe("PLAYING");
    expect(hanchan.wind).toBe("SOUTH");
    expect(hanchan.round).toBe(1);
    expect(hanchan.dealerIndex).toBe(0);
    expect(hand(hanchan).wind).toBe("SOUTH");
    for (let i = 0; i < 4; i++) hanchan = nextPlayerRon(hanchan);
    expect(hanchan.status).toBe("FINISHED");
    expect(hanchan.completedGames).toBe(8);
  });

  test("オーラスで親が和了したとき、トップなら終了（アガリ止め）、トップでなければ続行", () => {
    let top = start({
      mode: "TONPU",
      initialScores: { p1: 20_000, p2: 20_000, p3: 20_000, p4: 40_000 },
    });
    for (let i = 0; i < 3; i++) top = nextPlayerRon(top);
    expect(top.round).toBe(4);
    expect(dealerId(top)).toBe("p4");
    top = dealerTsumo(top);
    expect(top.status).toBe("FINISHED");
    expect(top.ranking[0]).toBe("p4");

    let behind = start({
      mode: "TONPU",
      initialScores: { p1: 40_000, p2: 20_000, p3: 20_000, p4: 20_000 },
    });
    for (let i = 0; i < 3; i++) behind = nextPlayerRon(behind);
    behind = dealerTsumo(behind);
    expect(behind.status).toBe("PLAYING");
    expect(behind.round).toBe(4);
    expect(behind.honba).toBe(1);
    expect(dealerId(behind)).toBe("p4");
  });

  test("誰かの点数がマイナスになると即終了し、残った供託はトップに渡る", () => {
    let state = withSticks(
      start({ initialScores: { p1: 500, p2: 25_000, p3: 25_000, p4: 49_500 } }),
      1,
    );
    // ノーテン罰符で p1 がマイナスになる
    state = exhaustiveDraw(state, ["p2"]);
    expect(state.status).toBe("FINISHED");
    expect(state.completedGames).toBe(1);
    expect(state.scores.p1).toBe(-500);
    expect(state.scores.p2).toBe(28_000);
    expect(state.scores.p4).toBe(49_500 - 1_000 + 1_000);
    expect(state.ranking).toEqual(["p4", "p2", "p3", "p1"]);
    expect(state.riichiSticks).toBe(0);
    expect(state.activePlayers).toEqual([]);
  });

  test("途中流局（九種九牌）は連荘して本場を積む", () => {
    const state = start();
    const nine: Tile[] = [
      "1m",
      "9m",
      "1p",
      "9p",
      "1s",
      "9s",
      "1z",
      "2z",
      "3z",
      "2m",
      "3m",
      "4p",
      "5s",
      "6s",
    ];
    const rigged = rig(state, { p1: nine });
    const next = act(rigged, sub("p1", { type: "KYUUSHU_KYUUHAI" }));
    expect(next.lastResult?.type).toBe("ABORTIVE_DRAW");
    expect(next.round).toBe(1);
    expect(next.dealerIndex).toBe(0);
    expect(next.honba).toBe(1);
    expect(next.scores).toEqual({ p1: 25_000, p2: 25_000, p3: 25_000, p4: 25_000 });
  });
});
