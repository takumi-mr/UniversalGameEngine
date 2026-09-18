import { expect, test, describe } from "bun:test";
import {
  MahjongRuleset as RealMahjongRuleset,
  MahjongRules,
  type MahjongAction,
  type MahjongOptions,
  type MahjongState,
  type Tile,
} from "@engine/shared/rules/mahjong/MahjongRuleset";
import { withTestRng } from "@engine/shared/testing/withTestRng";
import { UniversalEngine } from "@engine/shared/UniversalEngine";
import { MahjongHandEvaluator } from "@engine/shared/rules/mahjong/MahjongHandEvaluator";
import { createSecret } from "@engine/shared/GameRules";

// ルールセットを直接呼ぶテストなので、固定シードの RNG を補う
const MahjongRuleset = withTestRng(RealMahjongRuleset);
const PLAYERS = ["p1", "p2", "p3", "p4"];

/** 何も鳴けず、聴牌にも遠い手（チー・ポン・ロンが起きない） */
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
/** 王牌を固定する: 嶺上牌は 1s、ドラ表示牌・裏ドラ表示牌は 8p（ドラ 9p） */
const DEAD_WALL: Tile[] = ["1s", "1s", "1s", "1s", ...Array<Tile>(10).fill("8p")];

function startHand(options: Partial<MahjongOptions> = {}): MahjongState {
  const state = MahjongRuleset.getInitialState({ playerIds: PLAYERS, ...options });
  state.players = { 0: "p1", 1: "p2", 2: "p3", 3: "p4" };
  return MahjongRuleset.reduce(state, { type: "START", playerId: "p1" });
}

function setHand(state: MahjongState, playerId: string, tiles: Tile[]): MahjongState {
  return { ...state, hands: { ...state.hands, [playerId]: createSecret(tiles, [playerId]) } };
}

function setWall(state: MahjongState, tiles: Tile[]): MahjongState {
  return { ...state, wall: createSecret(tiles, []) };
}

/** 親 p1 が 14 枚、他は指定の手牌（省略時は JUNK）。王牌とドラを固定する */
function fixedHand(
  hands: Partial<Record<string, Tile[]>>,
  options: Partial<MahjongOptions> = {},
): MahjongState {
  let state = startHand(options);
  state = { ...state, deadWall: createSecret(DEAD_WALL, []), doraIndicators: ["8p"] };
  for (const playerId of PLAYERS) {
    state = setHand(state, playerId, hands[playerId] ?? JUNK);
  }
  return state;
}

function act(state: MahjongState, action: MahjongAction): MahjongState {
  expect(MahjongRuleset.isValidAction(state, action)).toBe(true);
  return MahjongRuleset.reduce(state, action);
}

function valid(state: MahjongState, action: MahjongAction): boolean {
  return MahjongRuleset.isValidAction(state, action);
}

describe("MahjongRuleset: 配牌と進行", () => {
  test("初期状態は WAITING", () => {
    const state = MahjongRuleset.getInitialState({ playerIds: PLAYERS });
    expect(state.status).toBe("WAITING");
    expect(state.phase).toBe("WAITING");
    expect(state.playerIds).toEqual(PLAYERS);
  });

  test("START で配牌し、親が第一自摸を引いた状態で親の手番になる", () => {
    const state = startHand();
    expect(state.status).toBe("PLAYING");
    expect(state.phase).toBe("PLAYING");
    expect(state.hands.p1.value).toHaveLength(14);
    for (const playerId of ["p2", "p3", "p4"]) {
      expect(state.hands[playerId].value).toHaveLength(13);
    }
    expect(state.wall.value).toHaveLength(136 - 14 - 13 * 4 - 1);
    expect(state.deadWall.value).toHaveLength(14);
    expect(state.doraIndicators).toEqual([state.deadWall.value[4]]);
    expect(state.activePlayers).toEqual(["p1"]);
    expect(state.turnIndex).toBe(0);
    // 全 136 枚が配られ、赤五は各色 1 枚
    const all = [
      ...state.wall.value,
      ...state.deadWall.value,
      ...PLAYERS.flatMap((id) => state.hands[id].value),
    ];
    expect(all).toHaveLength(136);
    expect(all.filter((tile) => tile.startsWith("0")).sort()).toEqual(["0m", "0p", "0s"]);
    expect(new Set(all)).toHaveLength(34 + 3);
  });

  test("dealerIndex で親を指定でき、自風は親から順に東南西北になる", () => {
    const state = startHand({ dealerIndex: 2 });
    expect(state.activePlayers).toEqual(["p3"]);
    expect(state.hands.p3.value).toHaveLength(14);
    expect(MahjongRules.seatWind(state, "p3")).toBe(1);
    expect(MahjongRules.seatWind(state, "p4")).toBe(2);
    expect(MahjongRules.seatWind(state, "p1")).toBe(3);
    expect(MahjongRules.seatWind(state, "p2")).toBe(4);
  });

  test("誰も鳴けない打牌は割り込みを挟まず、次のプレイヤーが自動で自摸る", () => {
    let state = fixedHand({ p1: [...JUNK, "9m"] });
    const wallBefore = state.wall.value.length;
    state = act(state, { type: "DISCARD", playerId: "p1", tile: "9m" });

    expect(state.phase).toBe("PLAYING");
    expect(state.activePlayers).toEqual(["p2"]);
    expect(state.turnIndex).toBe(1);
    expect(state.hands.p1.value).toHaveLength(13);
    expect(state.hands.p2.value).toHaveLength(14);
    expect(state.wall.value).toHaveLength(wallBefore - 1);
    expect(state.discards.p1).toEqual(["9m"]);
    expect(state.pendingDiscard).toBeUndefined();
  });

  test("手牌に無い牌や手番でないプレイヤーは打牌できない", () => {
    const state = fixedHand({ p1: [...JUNK, "9m"] });
    expect(valid(state, { type: "DISCARD", playerId: "p1", tile: "5m" })).toBe(false);
    expect(valid(state, { type: "DISCARD", playerId: "p2", tile: "1m" })).toBe(false);
  });

  test("鳴ける・ロンできるプレイヤーだけが割り込みの手番になる", () => {
    let state = fixedHand({
      p1: [...JUNK, "5s"],
      p3: ["5s", "5s", "1m", "2m", "3m", "4m", "6m", "7m", "8m", "1p", "2p", "3p", "1z"],
    });
    state = act(state, { type: "DISCARD", playerId: "p1", tile: "5s" });

    expect(state.phase).toBe("INTERRUPTING");
    expect(state.activePlayers).toEqual(["p3"]);
    expect(state.turnDeadline).toBe(10_000);
    expect(valid(state, { type: "PASS", playerId: "p2" })).toBe(false);
    expect(valid(state, { type: "RON", playerId: "p3" })).toBe(false);
    expect(MahjongRuleset.getLegalActions(state, "p3")).toEqual([
      { type: "CALL", playerId: "p3", meldType: "PON", consumed: ["5s", "5s"] },
      { type: "PASS", playerId: "p3" },
    ]);

    state = act(state, { type: "PASS", playerId: "p3" });
    expect(state.phase).toBe("PLAYING");
    expect(state.activePlayers).toEqual(["p2"]);
    expect(state.turnDeadline).toBeUndefined();
  });
});

describe("MahjongRuleset: 鳴き", () => {
  test("ポンすると鳴いた人の手番になり、直後に同じ牌は捨てられない（喰い替え）", () => {
    let state = fixedHand({
      p1: [...JUNK, "5s"],
      p3: ["5s", "5s", "5s", "1m", "2m", "3m", "4m", "6m", "7m", "8m", "1p", "2p", "1z"],
    });
    state = act(state, { type: "DISCARD", playerId: "p1", tile: "5s" });
    state = act(state, { type: "CALL", playerId: "p3", meldType: "PON", consumed: ["5s", "5s"] });

    expect(state.phase).toBe("PLAYING");
    expect(state.activePlayers).toEqual(["p3"]);
    expect(state.melds.p3).toEqual([
      { type: "PON", tile: "5s", consumed: ["5s", "5s"], from: "p1" },
    ]);
    expect(state.hands.p3.value).toHaveLength(11);
    expect(state.uninterrupted).toBe(false);
    expect(valid(state, { type: "DISCARD", playerId: "p3", tile: "5s" })).toBe(false);
    expect(valid(state, { type: "DISCARD", playerId: "p3", tile: "1z" })).toBe(true);

    state = act(state, { type: "DISCARD", playerId: "p3", tile: "1z" });
    expect(state.hands.p3.value).toHaveLength(10);
    expect(state.activePlayers).toEqual(["p4"]);
  });

  test("赤五を含むポン・大明槓は組み合わせごとに候補になる", () => {
    let state = fixedHand({
      p1: [...JUNK, "5m"],
      p2: ["0m", "5m", "5m", "1p", "2p", "3p", "4s", "5s", "6s", "1z", "2z", "3z", "4z"],
    });
    state = act(state, { type: "DISCARD", playerId: "p1", tile: "5m" });
    const calls = MahjongRuleset.getLegalActions(state, "p2").filter((a) => a.type === "CALL");
    expect(calls).toEqual([
      { type: "CALL", playerId: "p2", meldType: "PON", consumed: ["0m", "5m"] },
      { type: "CALL", playerId: "p2", meldType: "PON", consumed: ["5m", "5m"] },
      { type: "CALL", playerId: "p2", meldType: "KAN", consumed: ["0m", "5m", "5m"] },
    ]);
    // consumed を省略したポンは手牌から補う
    state = act(state, { type: "CALL", playerId: "p2", meldType: "PON" });
    expect(state.melds.p2[0]!.consumed).toEqual(["0m", "5m"]);
  });

  test("チーは上家の捨て牌にだけでき、両端をチーしたら反対側の筋も捨てられない", () => {
    const hand: Tile[] = [
      "4m",
      "5m",
      "6m",
      "1p",
      "4p",
      "7p",
      "1s",
      "4s",
      "7s",
      "1z",
      "2z",
      "3z",
      "4z",
    ];
    let state = fixedHand({ p1: [...JUNK, "3m"], p2: hand, p3: hand });
    state = act(state, { type: "DISCARD", playerId: "p1", tile: "3m" });

    const chi: MahjongAction = {
      type: "CALL",
      playerId: "p2",
      meldType: "CHI",
      consumed: ["4m", "5m"],
    };
    expect(state.activePlayers).toEqual(["p2"]); // p3 は下家ではないのでチーできない
    expect(valid(state, chi)).toBe(true);
    expect(valid(state, { ...chi, playerId: "p3" })).toBe(false);
    expect(valid(state, { ...chi, consumed: ["4m", "6m"] })).toBe(false);
    expect(valid(state, { ...chi, consumed: undefined })).toBe(false);

    state = act(state, chi);
    expect(state.melds.p2).toEqual([
      { type: "CHI", tile: "3m", consumed: ["4m", "5m"], from: "p1" },
    ]);
    expect(state.kuikaeForbidden).toEqual(["3m", "6m"]);
    expect(valid(state, { type: "DISCARD", playerId: "p2", tile: "6m" })).toBe(false);
    expect(valid(state, { type: "DISCARD", playerId: "p2", tile: "1p" })).toBe(true);
  });

  test("チーの候補は赤五の有無ごとに列挙され、ポンはチーに優先する", () => {
    let state = fixedHand({
      p1: [...JUNK, "4p"],
      p2: ["0p", "5p", "3p", "6p", "1m", "4m", "7m", "1s", "4s", "7s", "1z", "2z", "3z"],
      p3: ["4p", "4p", "1m", "4m", "7m", "1s", "4s", "7s", "1z", "2z", "3z", "5z", "6z"],
    });
    state = act(state, { type: "DISCARD", playerId: "p1", tile: "4p" });
    expect(state.activePlayers).toEqual(["p2", "p3"]);
    expect(MahjongRules.chiOptions(state.hands.p2.value, "4p")).toEqual([
      ["3p", "0p"],
      ["3p", "5p"],
      ["0p", "6p"],
      ["5p", "6p"],
    ]);

    state = act(state, { type: "CALL", playerId: "p2", meldType: "CHI", consumed: ["3p", "5p"] });
    expect(state.phase).toBe("INTERRUPTING"); // p3 の応答待ち
    state = act(state, { type: "CALL", playerId: "p3", meldType: "PON", consumed: ["4p", "4p"] });
    expect(state.melds.p3).toHaveLength(1);
    expect(state.melds.p2).toHaveLength(0);
    expect(state.hands.p2.value).toHaveLength(13);
    expect(state.activePlayers).toEqual(["p3"]);
  });

  test("河底牌（山が空のときの捨て牌）は鳴けない", () => {
    let state = fixedHand({
      p1: [...JUNK, "5s"],
      p3: ["5s", "5s", "1m", "2m", "3m", "4m", "6m", "7m", "8m", "1p", "2p", "3p", "1z"],
    });
    state = setWall(state, []);
    state = act(state, { type: "DISCARD", playerId: "p1", tile: "5s" });
    expect(state.status).toBe("FINISHED");
    expect(state.result?.type).toBe("EXHAUSTIVE_DRAW");
  });
});

describe("MahjongRuleset: 和了", () => {
  test("役の無い和了形ではロンできない（自風なら役になる）", () => {
    let state = fixedHand({ p1: [...JUNK, "2z"], p2: SHANPON_WAIT, p3: SHANPON_WAIT });
    state = act(state, { type: "DISCARD", playerId: "p1", tile: "2z" });

    // p2 は南家: 南の刻子が役牌。p3 は西家: 無役（ポンはできる）
    expect(state.activePlayers).toEqual(["p2", "p3"]);
    expect(valid(state, { type: "RON", playerId: "p2" })).toBe(true);
    expect(valid(state, { type: "RON", playerId: "p3" })).toBe(false);
    expect(MahjongRuleset.getLegalActions(state, "p2").map((a) => a.type)).toEqual([
      "RON",
      "CALL",
      "PASS",
    ]);
    expect(MahjongRuleset.getLegalActions(state, "p3").map((a) => a.type)).toEqual([
      "CALL",
      "PASS",
    ]);
  });

  test("ロンの精算: 放銃者が支払い、本場は 300 点ずつ、供託は和了者へ", () => {
    let state = fixedHand({ p1: [...JUNK, "2z"], p2: SHANPON_WAIT }, { honba: 2, riichiSticks: 1 });
    state = act(state, { type: "DISCARD", playerId: "p1", tile: "2z" });
    state = act(state, { type: "RON", playerId: "p2" });

    expect(state.status).toBe("FINISHED");
    expect(state.result?.type).toBe("WIN");
    const winner = state.result!.winners[0]!;
    expect(winner.playerId).toBe("p2");
    expect(winner.from).toBe("p1");
    expect(winner.yaku).toEqual({ 自風南: "1飜" });
    expect(winner.fu).toBe(40);
    expect(winner.ten).toBe(1_300);
    // 1300 + 本場 600 + 供託 1000
    expect(state.scores.p2).toBe(25_000 + 1_300 + 600 + 1_000);
    expect(state.scores.p1).toBe(25_000 - 1_300 - 600);
    expect(state.riichiSticks).toBe(0);
    expect(state.result?.renchan).toBe(false);
    expect(state.hands.p2.value).toContain("2z");
    expect(RealMahjongRuleset.checkWinCondition(state)).toEqual({
      isFinished: true,
      winnerIds: ["p2"],
      message: state.message,
    });
  });

  test("親の自摸は子が全員同額を払い、本場は 100 点ずつ", () => {
    let state = fixedHand({ p1: [...SHANPON_WAIT, "2z"] }, { honba: 1 });
    // 配牌和了（天和）にならないよう、既に一巡しているものとする
    state = { ...state, discards: { ...state.discards, p1: ["9m"] } };
    expect(valid(state, { type: "TSUMO", playerId: "p1" })).toBe(true);
    state = act(state, { type: "TSUMO", playerId: "p1" });

    const winner = state.result!.winners[0]!;
    expect(winner.isTsumo).toBe(true);
    expect(winner.yaku).toEqual({ 門前清自摸和: "1飜" });
    expect(winner.fu).toBe(40); // 20 + 自摸 2 + 南の暗刻 8 + 連風牌の雀頭 4
    expect(winner.ten).toBe(2_100); // 700 all
    for (const playerId of ["p2", "p3", "p4"]) expect(state.scores[playerId]).toBe(25_000 - 800);
    expect(state.scores.p1).toBe(25_000 + 2_400);
    expect(state.result?.renchan).toBe(true);
  });

  test("子の自摸は親が倍額を払い、山の最後の牌なら海底摸月", () => {
    let state = fixedHand({ p1: [...JUNK, "9m"], p2: SHANPON_WAIT });
    state = setWall(state, ["2z"]);
    state = { ...state, discards: { ...state.discards, p2: ["9m"] } }; // 地和にしない
    state = act(state, { type: "DISCARD", playerId: "p1", tile: "9m" });
    expect(state.activePlayers).toEqual(["p2"]);
    expect(state.hands.p2.value.at(-1)).toBe("2z");
    state = act(state, { type: "TSUMO", playerId: "p2" });

    const winner = state.result!.winners[0]!;
    expect(winner.yaku).toEqual({ 門前清自摸和: "1飜", 自風南: "1飜", 海底摸月: "1飜" });
    expect(winner.ten).toBe(5_200); // 40 符 3 飜: 親 2600 子 1300
    expect(state.scores.p1).toBe(25_000 - 2_600);
    expect(state.scores.p3).toBe(25_000 - 1_300);
    expect(state.scores.p4).toBe(25_000 - 1_300);
    expect(state.scores.p2).toBe(25_000 + 5_200);
    expect(state.result?.renchan).toBe(false);
  });

  test("河底撈魚: 山が空のときの捨て牌でのロン", () => {
    let state = fixedHand({ p1: [...JUNK, "2z"], p2: SHANPON_WAIT });
    state = setWall(state, []);
    state = act(state, { type: "DISCARD", playerId: "p1", tile: "2z" });
    state = act(state, { type: "RON", playerId: "p2" });
    expect(state.result!.winners[0]!.yaku).toHaveProperty("河底撈魚");
  });

  test("天和: 親の配牌が和了形なら第一自摸で役満", () => {
    let state = fixedHand({ p1: [...SHANPON_WAIT, "2z"] });
    state = act(state, { type: "TSUMO", playerId: "p1" });
    const winner = state.result!.winners[0]!;
    expect(winner.yaku).toHaveProperty("天和");
    expect(winner.yakuman).toBe(1);
    expect(winner.ten).toBe(48_000);
  });

  test("地和: 子の第一自摸（誰も鳴いていない）で役満", () => {
    let state = fixedHand({ p1: [...JUNK, "9m"], p2: SHANPON_WAIT });
    state = setWall(state, ["5m", "5m", "2z"]);
    state = act(state, { type: "DISCARD", playerId: "p1", tile: "9m" });
    state = act(state, { type: "TSUMO", playerId: "p2" });
    expect(state.result!.winners[0]!.yaku).toHaveProperty("地和");
  });

  test("ダブロンは両者に支払い、供託は放銃者に近い和了者が受け取る", () => {
    // p4 は 333z の暗刻と 2z 単騎。北家で無役なので立直中とする
    const tanki: Tile[] = [
      "2m",
      "3m",
      "4m",
      "5p",
      "6p",
      "7p",
      "6s",
      "7s",
      "8s",
      "3z",
      "3z",
      "3z",
      "2z",
    ];
    let state = fixedHand(
      { p1: [...JUNK, "2z"], p2: SHANPON_WAIT, p4: tanki },
      { riichiSticks: 1 },
    );
    state = { ...state, riichi: { ...state.riichi, p4: true } };
    state = act(state, { type: "DISCARD", playerId: "p1", tile: "2z" });
    expect(state.activePlayers).toEqual(["p2", "p4"]);
    state = act(state, { type: "RON", playerId: "p4" });
    state = act(state, { type: "RON", playerId: "p2" });

    expect(state.result!.winners.map((w) => w.playerId)).toEqual(["p2", "p4"]);
    expect(state.result!.winners[1]!.yaku).toEqual({ 立直: "1飜" });
    expect(state.scores.p2).toBe(25_000 + 1_300 + 1_000);
    expect(state.scores.p4).toBe(25_000 + 1_300);
    expect(state.scores.p1).toBe(25_000 - 2_600);
    expect(state.uraDoraIndicators).toEqual(["8p"]);
  });

  test("三家和は途中流局", () => {
    let state = fixedHand({
      p1: [...JUNK, "2z"],
      p2: SHANPON_WAIT,
      p3: SHANPON_WAIT,
      p4: SHANPON_WAIT,
    });
    state = { ...state, riichi: { p1: false, p2: true, p3: true, p4: true } };
    state = act(state, { type: "DISCARD", playerId: "p1", tile: "2z" });
    for (const playerId of ["p2", "p3", "p4"]) state = act(state, { type: "RON", playerId });
    expect(state.result?.type).toBe("ABORTIVE_DRAW");
    expect(state.result?.reason).toBe("三家和");
    expect(state.result?.renchan).toBe(true);
    expect(state.scores).toEqual({ p1: 25_000, p2: 25_000, p3: 25_000, p4: 25_000 });
  });
});

describe("MahjongRuleset: 立直", () => {
  const TENPAI_14: Tile[] = [...SHANPON_WAIT, "9m"];

  test("聴牌になる打牌でのみ立直でき、供託と点数が動く", () => {
    let state = fixedHand({ p1: TENPAI_14 });
    expect(valid(state, { type: "RIICHI", playerId: "p1", tile: "9m" })).toBe(true);
    expect(valid(state, { type: "RIICHI", playerId: "p1", tile: "1m" })).toBe(false);
    const riichiTiles = MahjongRuleset.getLegalActions(state, "p1")
      .filter((a) => a.type === "RIICHI")
      .map((a) => a.tile);
    expect(riichiTiles).toEqual(["9m"]);

    state = act(state, { type: "RIICHI", playerId: "p1", tile: "9m" });
    expect(state.riichi.p1).toBe(true);
    expect(state.doubleRiichi.p1).toBe(true); // 第一打で誰も鳴いていない
    expect(state.ippatsu.p1).toBe(true);
    expect(state.scores.p1).toBe(24_000);
    expect(state.riichiSticks).toBe(1);
    expect(state.discards.p1).toEqual(["9m"]);
  });

  test("副露している・点数が足りない・山が残り少ないときは立直できない（暗槓は門前）", () => {
    const base = fixedHand({ p1: TENPAI_14 });
    const riichi: MahjongAction = { type: "RIICHI", playerId: "p1", tile: "9m" };

    const pon = setHand(
      {
        ...base,
        melds: {
          ...base.melds,
          p1: [{ type: "PON", tile: "1z", consumed: ["1z", "1z"], from: "p2" }],
        },
      },
      "p1",
      ["1m", "2m", "3m", "4p", "5p", "6p", "7s", "8s", "2z", "2z", "9m"],
    );
    expect(valid(pon, riichi)).toBe(false);

    const ankan = setHand(
      {
        ...base,
        melds: {
          ...base.melds,
          p1: [{ type: "ANKAN", tile: "1z", consumed: ["1z", "1z", "1z", "1z"] }],
        },
      },
      "p1",
      ["1m", "2m", "3m", "4p", "5p", "6p", "7s", "8s", "2z", "2z", "9m"],
    );
    expect(valid(ankan, riichi)).toBe(true);

    expect(valid({ ...base, scores: { ...base.scores, p1: 900 } }, riichi)).toBe(false);
    expect(valid(setWall(base, ["1s", "1s", "1s"]), riichi)).toBe(false);
    expect(valid(setWall(base, ["1s", "1s", "1s", "1s"]), riichi)).toBe(true);
  });

  test("立直後は自摸切りしかできず、暗槓は待ちが変わらない自摸牌のみ", () => {
    let state = fixedHand({ p1: TENPAI_14 });
    state = setWall(state, ["9p", "9p", "1m", "3z", "3z", "3z"]);
    state = act(state, { type: "RIICHI", playerId: "p1", tile: "9m" });
    // p2..p4 が自摸切りして p1 に戻る
    for (const playerId of ["p2", "p3", "p4"]) {
      expect(state.activePlayers).toEqual([playerId]);
      state = act(state, { type: "DISCARD", playerId, tile: "3z" });
    }
    expect(state.activePlayers).toEqual(["p1"]);
    expect(state.hands.p1.value.at(-1)).toBe("1m");
    expect(valid(state, { type: "DISCARD", playerId: "p1", tile: "1m" })).toBe(true);
    expect(valid(state, { type: "DISCARD", playerId: "p1", tile: "4p" })).toBe(false);
    expect(valid(state, { type: "ANKAN", playerId: "p1", tile: "1m" })).toBe(false); // 1m は 2 枚

    // 111m + 自摸 1m の暗槓は待ち（1z/2z）を変えないので可
    const fourOfAKind = setHand(state, "p1", [
      "1m",
      "1m",
      "1m",
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
      "1m",
    ]);
    expect(valid(fourOfAKind, { type: "ANKAN", playerId: "p1", tile: "1m" })).toBe(true);
    // 自摸牌でない牌の暗槓は不可
    const notDrawn = setHand(state, "p1", [
      "1m",
      "1m",
      "1m",
      "1m",
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
    ]);
    expect(valid(notDrawn, { type: "ANKAN", playerId: "p1", tile: "1m" })).toBe(false);
    // 待ちが変わる暗槓は不可: 22234m 567p 789s 22z（2m/5m/2z 待ち）で 2m を自摸って 2222m にすると 2z 待ちが消える
    const changesWait = setHand(state, "p1", [
      "2m",
      "2m",
      "2m",
      "3m",
      "4m",
      "5p",
      "6p",
      "7p",
      "7s",
      "8s",
      "9s",
      "2z",
      "2z",
      "2m",
    ]);
    expect(MahjongRules.waitingTiles(changesWait.hands.p1.value.slice(0, -1))).toEqual([
      "2m",
      "5m",
      "2z",
    ]);
    expect(valid(changesWait, { type: "ANKAN", playerId: "p1", tile: "2m" })).toBe(false);
  });

  test("立直宣言牌をロンされると立直は成立せず供託も戻る", () => {
    let state = fixedHand({
      p1: ["1m", "2m", "3m", "4p", "5p", "6p", "7s", "8s", "9s", "1z", "1z", "3z", "3z", "2z"],
      p2: SHANPON_WAIT,
    });
    state = act(state, { type: "RIICHI", playerId: "p1", tile: "2z" });
    expect(state.scores.p1).toBe(24_000);
    expect(state.riichiSticks).toBe(1);
    state = act(state, { type: "RON", playerId: "p2" });

    expect(state.riichi.p1).toBe(false);
    expect(state.riichiSticks).toBe(0);
    expect(state.scores.p1).toBe(25_000 - 1_300);
    expect(state.scores.p2).toBe(25_000 + 1_300);
  });

  test("一発: 立直後の最初の自摸で和了すると一発が付き、裏ドラをめくる", () => {
    let state = fixedHand({ p1: TENPAI_14 });
    state = setWall(state, ["9p", "9p", "2z", "3z", "3z", "3z"]);
    state = act(state, { type: "RIICHI", playerId: "p1", tile: "9m" });
    for (const playerId of ["p2", "p3", "p4"]) {
      state = act(state, { type: "DISCARD", playerId, tile: "3z" });
    }
    expect(state.hands.p1.value.at(-1)).toBe("2z");
    state = act(state, { type: "TSUMO", playerId: "p1" });
    const winner = state.result!.winners[0]!;
    expect(winner.yaku).toEqual({ ダブル立直: "2飜", 一発: "1飜", 門前清自摸和: "1飜" });
    expect(state.uraDoraIndicators).toEqual(["8p"]);
  });

  test("一発は鳴きが入ると消える", () => {
    let state = fixedHand({
      p1: TENPAI_14,
      p3: ["3z", "3z", "1m", "4m", "7m", "1p", "4p", "7p", "1s", "4s", "7s", "5z", "6z"],
    });
    state = setWall(state, ["9p", "9p", "2z", "9p", "3z"]);
    state = act(state, { type: "RIICHI", playerId: "p1", tile: "9m" });
    expect(state.ippatsu.p1).toBe(true);
    state = act(state, { type: "DISCARD", playerId: "p2", tile: "3z" });
    state = act(state, { type: "CALL", playerId: "p3", meldType: "PON", consumed: ["3z", "3z"] });
    expect(state.ippatsu.p1).toBe(false);
  });

  test("四家立直は途中流局", () => {
    const base: Tile[] = ["1m", "2m", "3m", "4p", "5p", "6p", "7s", "8s", "9s"];
    let state = fixedHand({
      p1: [...base, "1z", "1z", "5z", "5z", "2p"],
      p2: [...base, "2z", "2z", "6z", "6z"],
      p3: [...base, "3z", "3z", "7z", "7z"],
      p4: [...base, "4z", "4z", "9m", "9m"],
    });
    state = setWall(state, Array<Tile>(8).fill("1s"));
    state = act(state, { type: "RIICHI", playerId: "p1", tile: "2p" });
    for (const playerId of ["p2", "p3", "p4"]) {
      expect(state.activePlayers).toEqual([playerId]);
      state = act(state, { type: "RIICHI", playerId, tile: "1s" });
    }
    expect(state.status).toBe("FINISHED");
    expect(state.result?.reason).toBe("四家立直");
    expect(state.riichiSticks).toBe(4);
  });
});

describe("MahjongRuleset: フリテン", () => {
  /** 123m 456p 789s 22z 45m: 3m / 6m の両面待ち（平和） */
  const RYANMEN: Tile[] = [
    "1m",
    "2m",
    "3m",
    "4p",
    "5p",
    "6p",
    "7s",
    "8s",
    "9s",
    "2z",
    "2z",
    "4m",
    "5m",
  ];
  /** 6m を持っていて、鳴けない手 */
  const WITH_6M: Tile[] = [...JUNK.slice(0, 12), "6m"];

  test("待ち牌を自分で捨てているとロンできない", () => {
    const base = fixedHand({ p1: [...JUNK, "6m"], p3: RYANMEN });
    const open = act(base, { type: "DISCARD", playerId: "p1", tile: "6m" });
    expect(open.activePlayers).toEqual(["p3"]);
    expect(valid(open, { type: "RON", playerId: "p3" })).toBe(true);

    const furiten = { ...base, discards: { ...base.discards, p3: ["3m"] } };
    const closed = act(furiten, { type: "DISCARD", playerId: "p1", tile: "6m" });
    expect(closed.phase).toBe("PLAYING"); // p3 はロンできないので割り込み無し
    expect(closed.activePlayers).toEqual(["p2"]);
  });

  test("見逃すと次の自摸までフリテン（同巡フリテン）", () => {
    let state = fixedHand({ p1: [...JUNK, "6m"], p2: WITH_6M, p4: RYANMEN });
    state = setWall(state, ["9p", "9p", "9p", "9p"]);
    state = act(state, { type: "DISCARD", playerId: "p1", tile: "6m" });
    expect(state.activePlayers).toEqual(["p4"]);
    state = act(state, { type: "PASS", playerId: "p4" });
    expect(state.furiten.p4).toBe(true);

    // p2 の 6m ではロンできず、割り込みも起きない
    expect(state.activePlayers).toEqual(["p2"]);
    state = act(state, { type: "DISCARD", playerId: "p2", tile: "6m" });
    expect(state.phase).toBe("PLAYING");
    expect(state.activePlayers).toEqual(["p3"]);
    expect(state.furiten.p4).toBe(true);

    // p4 の自摸で解消する
    state = act(state, { type: "DISCARD", playerId: "p3", tile: "4z" });
    expect(state.activePlayers).toEqual(["p4"]);
    expect(state.furiten.p4).toBe(false);
  });

  test("立直中の見逃しは局の終わりまでフリテン", () => {
    let state = fixedHand({ p1: [...JUNK, "6m"], p3: RYANMEN, p4: WITH_6M });
    state = { ...state, riichi: { ...state.riichi, p3: true } };
    state = setWall(state, ["9p", "9p", "9p", "9p"]);
    state = act(state, { type: "DISCARD", playerId: "p1", tile: "6m" });
    state = act(state, { type: "PASS", playerId: "p3" });
    state = act(state, { type: "DISCARD", playerId: "p2", tile: "4z" });
    expect(state.activePlayers).toEqual(["p3"]);
    expect(state.furiten.p3).toBe(true);
    state = act(state, { type: "DISCARD", playerId: "p3", tile: "9p" });
    state = act(state, { type: "DISCARD", playerId: "p4", tile: "6m" });
    expect(state.phase).toBe("PLAYING");
    expect(state.activePlayers).toEqual(["p1"]);
  });
});

describe("MahjongRuleset: 槓", () => {
  test("暗槓: 即座に槓ドラをめくり、嶺上牌を自摸る。和了すれば嶺上開花", () => {
    let state = fixedHand({
      p1: ["1m", "1m", "1m", "1m", "4p", "5p", "6p", "7s", "8s", "9s", "1z", "1z", "2z", "2z"],
    });
    const wallBefore = state.wall.value.length;
    expect(valid(state, { type: "ANKAN", playerId: "p1", tile: "1m" })).toBe(true);
    state = act(state, { type: "ANKAN", playerId: "p1", tile: "1m" });

    expect(state.melds.p1).toEqual([
      { type: "ANKAN", tile: "1m", consumed: ["1m", "1m", "1m", "1m"] },
    ]);
    expect(state.hands.p1.value).toHaveLength(11);
    expect(state.hands.p1.value.at(-1)).toBe("1s"); // 嶺上牌
    expect(state.doraIndicators).toEqual(["8p", "8p"]);
    expect(state.wall.value).toHaveLength(wallBefore - 1); // 海底牌が王牌に移る
    expect(state.deadWall.value).toHaveLength(15);
    expect(state.kanCount).toBe(1);
    expect(state.rinshanDrawn).toBe(1);
    expect(state.afterKan).toBe(true);
    expect(state.uninterrupted).toBe(false);
    expect(state.activePlayers).toEqual(["p1"]);

    // 嶺上牌を 2z にして自摸和了
    state = setHand(state, "p1", [
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
      "2z",
    ]);
    expect(valid(state, { type: "TSUMO", playerId: "p1" })).toBe(true);
    state = act(state, { type: "TSUMO", playerId: "p1" });
    expect(state.result!.winners[0]!.yaku).toHaveProperty("嶺上開花");
  });

  test("大明槓: 嶺上牌を自摸り、槓ドラは打牌後にめくる", () => {
    let state = fixedHand({
      p1: [...JUNK, "5s"],
      p3: ["5s", "5s", "5s", "1m", "2m", "3m", "4m", "6m", "7m", "8m", "1p", "2p", "1z"],
    });
    state = act(state, { type: "DISCARD", playerId: "p1", tile: "5s" });
    state = act(state, { type: "CALL", playerId: "p3", meldType: "KAN" });

    expect(state.melds.p3).toEqual([
      { type: "DAIMINKAN", tile: "5s", consumed: ["5s", "5s", "5s"], from: "p1" },
    ]);
    expect(state.hands.p3.value).toHaveLength(11);
    expect(state.activePlayers).toEqual(["p3"]);
    expect(state.doraIndicators).toHaveLength(1);
    expect(state.pendingDoraReveals).toBe(1);

    state = act(state, { type: "DISCARD", playerId: "p3", tile: "1z" });
    expect(state.doraIndicators).toHaveLength(2);
    expect(state.pendingDoraReveals).toBe(0);
  });

  test("加槓: ロンできる相手がいれば搶槓の窓が開き、搶槓で和了できる", () => {
    let state = fixedHand({
      p1: ["2z", "1m", "4m", "7m", "1p", "4p", "7p", "1s", "4s", "7s", "3z"],
      p3: SHANPON_WAIT,
    });
    state = {
      ...state,
      melds: {
        ...state.melds,
        p1: [{ type: "PON", tile: "2z", consumed: ["2z", "2z"], from: "p4" }],
      },
      riichi: { ...state.riichi, p3: true },
    };
    expect(valid(state, { type: "KAKAN", playerId: "p1", tile: "2z" })).toBe(true);
    expect(MahjongRuleset.getLegalActions(state, "p1")).toContainEqual({
      type: "KAKAN",
      playerId: "p1",
      tile: "2z",
    });
    state = act(state, { type: "KAKAN", playerId: "p1", tile: "2z" });

    expect(state.phase).toBe("INTERRUPTING");
    expect(state.activePlayers).toEqual(["p3"]);
    expect(state.pendingKan?.tile).toBe("2z");
    expect(valid(state, { type: "CALL", playerId: "p3", meldType: "PON" })).toBe(false);
    expect(MahjongRuleset.getLegalActions(state, "p3")).toEqual([
      { type: "RON", playerId: "p3" },
      { type: "PASS", playerId: "p3" },
    ]);
    state = act(state, { type: "RON", playerId: "p3" });
    expect(state.result!.winners[0]!.yaku).toHaveProperty("搶槓");
    expect(state.result!.winners[0]!.from).toBe("p1");
    expect(state.melds.p1[0]!.type).toBe("PON"); // 槓は成立していない
  });

  test("加槓: 誰もロンできなければそのまま成立して嶺上牌を自摸る", () => {
    let state = fixedHand({
      p1: ["2z", "1m", "4m", "7m", "1p", "4p", "7p", "1s", "4s", "7s", "3z"],
    });
    state = {
      ...state,
      melds: {
        ...state.melds,
        p1: [{ type: "PON", tile: "2z", consumed: ["2z", "2z"], from: "p4" }],
      },
    };
    state = act(state, { type: "KAKAN", playerId: "p1", tile: "2z" });
    expect(state.phase).toBe("PLAYING");
    expect(state.melds.p1).toEqual([
      { type: "KAKAN", tile: "2z", consumed: ["2z", "2z", "2z"], from: "p4" },
    ]);
    expect(state.hands.p1.value).toHaveLength(11);
    expect(state.kanCount).toBe(1);
    expect(state.pendingDoraReveals).toBe(1);
  });

  test("四開槓: 複数人で 4 回槓すると、その後の打牌が通った時点で途中流局", () => {
    let state = fixedHand({
      p1: [...JUNK, "5s"],
      p2: JUNK.slice(0, 10),
      p3: ["5s", "5s", "5s", "1m", "2m", "3m", "4m", "6m", "7m", "8m", "1p", "2p", "1z"],
    });
    state = {
      ...state,
      kanCount: 3,
      melds: {
        ...state.melds,
        p2: [{ type: "ANKAN", tile: "9p", consumed: ["9p", "9p", "9p", "9p"] }],
      },
    };
    state = act(state, { type: "DISCARD", playerId: "p1", tile: "5s" });
    state = act(state, { type: "CALL", playerId: "p3", meldType: "KAN" });
    expect(state.kanCount).toBe(4);
    state = act(state, { type: "DISCARD", playerId: "p3", tile: "1z" });
    expect(state.result?.reason).toBe("四開槓");
  });
});

describe("MahjongRuleset: 流局", () => {
  test("荒牌流局: ノーテン罰符を払い、親が聴牌なら連荘", () => {
    let state = fixedHand({ p1: [...JUNK, "9m"], p2: SHANPON_WAIT });
    state = setWall(state, []);
    state = act(state, { type: "DISCARD", playerId: "p1", tile: "9m" });

    expect(state.status).toBe("FINISHED");
    expect(state.result?.type).toBe("EXHAUSTIVE_DRAW");
    expect(state.result?.tenpai).toEqual(["p2"]);
    expect(state.scores.p2).toBe(28_000);
    for (const playerId of ["p1", "p3", "p4"]) expect(state.scores[playerId]).toBe(24_000);
    expect(state.result?.renchan).toBe(false);
    expect(RealMahjongRuleset.checkWinCondition(state).winnerIds).toEqual([]);

    let dealerTenpai = fixedHand({ p1: [...SHANPON_WAIT, "9m"], p2: SHANPON_WAIT });
    dealerTenpai = setWall(dealerTenpai, []);
    dealerTenpai = act(dealerTenpai, { type: "DISCARD", playerId: "p1", tile: "9m" });
    expect(dealerTenpai.result?.tenpai).toEqual(["p1", "p2"]);
    expect(dealerTenpai.scores.p1).toBe(26_500);
    expect(dealerTenpai.scores.p3).toBe(23_500);
    expect(dealerTenpai.result?.renchan).toBe(true);
  });

  test("九種九牌は誰でも最初の自摸で宣言でき、鳴きが入ると宣言できない", () => {
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
    ];
    let state = fixedHand({ p1: [...JUNK, "9m"], p2: nine });
    expect(valid(state, { type: "KYUUSHU_KYUUHAI", playerId: "p2" })).toBe(false); // 手番でない
    state = act(state, { type: "DISCARD", playerId: "p1", tile: "9m" });
    expect(valid(state, { type: "KYUUSHU_KYUUHAI", playerId: "p2" })).toBe(true);
    const ended = act(state, { type: "KYUUSHU_KYUUHAI", playerId: "p2" });
    expect(ended.result?.reason).toBe("九種九牌");
    expect(ended.result?.renchan).toBe(true);

    expect(
      valid({ ...state, uninterrupted: false }, { type: "KYUUSHU_KYUUHAI", playerId: "p2" }),
    ).toBe(false);
    const eight = setHand(state, "p2", [...nine.slice(0, 8), "2m", "3m", "4m", "5m", "6m", "8p"]);
    expect(eight.hands.p2.value).toHaveLength(14);
    expect(valid(eight, { type: "KYUUSHU_KYUUHAI", playerId: "p2" })).toBe(false);
  });

  test("四風連打は途中流局", () => {
    let state = fixedHand({
      p1: [...JUNK, "1z"],
      p2: [...JUNK.slice(0, 9), "1z", "5z", "6z", "7z"],
      p3: [...JUNK.slice(0, 9), "1z", "5z", "6z", "7z"],
      p4: [...JUNK.slice(0, 9), "1z", "5z", "6z", "7z"],
    });
    state = setWall(state, ["9m", "9m", "9m"]);
    for (const playerId of PLAYERS) state = act(state, { type: "DISCARD", playerId, tile: "1z" });
    expect(state.result?.reason).toBe("四風連打");
  });
});

describe("MahjongRuleset: 合法手・タイムアウト・評価", () => {
  test("getLegalActions は手番の打牌と特殊手だけを返し、全て isValidAction を通る", () => {
    const state = fixedHand({
      p1: ["1m", "1m", "1m", "1m", "4p", "5p", "6p", "7s", "8s", "9s", "1z", "1z", "2z", "2z"],
    });
    const actions = MahjongRuleset.getLegalActions(state, "p1");
    expect(actions.every((a) => valid(state, a))).toBe(true);
    expect(actions.filter((a) => a.type === "RIICHI")).toEqual([
      { type: "RIICHI", playerId: "p1", tile: "1m" },
    ]);
    expect(actions.filter((a) => a.type === "ANKAN")).toEqual([
      { type: "ANKAN", playerId: "p1", tile: "1m" },
    ]);
    expect(actions.filter((a) => a.type === "DISCARD")).toHaveLength(9);
    expect(actions).toHaveLength(11);
    expect(MahjongRuleset.getLegalActions(state, "p2")).toEqual([]);
  });

  test("タイムアウトは割り込み待ちでは PASS、手番では自摸切りになる", () => {
    const engine = new UniversalEngine(RealMahjongRuleset, {
      serverSeed: "mahjong-timeout-seed",
      clientSeed: "mahjong-timeout-client",
    });
    for (const playerId of PLAYERS) {
      expect(engine.dispatch({ type: "JOIN", playerId } as any)).toBe(true);
    }
    expect(engine.dispatch({ type: "START", playerId: "p1", timestamp: 1_000 })).toBe(true);
    expect(engine.getState().hands.p1.value).toHaveLength(14);

    expect(RealMahjongRuleset.getTimeoutAction!(engine.getState(), "p1")).toEqual({
      type: "DISCARD",
      playerId: "p1",
      tile: engine.getState().hands.p1.value.at(-1)!,
    });

    // 誰かが鳴ける・ロンできる打牌が出るまで自摸切りを続け、TIMEOUT で流す
    let discards = 0;
    while (engine.getState().phase === "PLAYING" && discards < 60) {
      const state = engine.getState();
      const playerId = state.activePlayers![0]!;
      const tile = state.hands[playerId].value.at(-1)!;
      expect(engine.dispatch({ type: "DISCARD", playerId, tile, timestamp: 2_000 })).toBe(true);
      discards++;
    }
    const state = engine.getState();
    expect(state.phase).toBe("INTERRUPTING");
    const deadline = state.turnDeadline!;
    expect(deadline).toBe(12_000);
    for (const playerId of state.activePlayers!) {
      expect(engine.dispatch({ type: "TIMEOUT", playerId, timestamp: deadline } as any)).toBe(true);
    }
    expect(engine.getState().phase).toBe("PLAYING");
    expect(engine.getState().turnDeadline).toBeUndefined();
    expect(engine.history.at(-1)!.type as string).toBe("TIMEOUT");
  });

  test("赤五は赤ドラ、表示牌のドラも数える（赤無しの設定では赤ドラを数えない）", () => {
    const hand: Tile[] = [
      "1m",
      "2m",
      "3m",
      "0m",
      "6m",
      "7m",
      "2p",
      "3p",
      "4p",
      "6s",
      "7s",
      "8s",
      "1z",
      "1z",
    ];
    const context = { roundWind: 1 as const, seatWind: 2 as const, doraIndicators: ["4m"] };
    const result = MahjongHandEvaluator.evaluate(hand, [], "1z", true, context);
    expect(result.isAgari).toBe(true);
    expect(result.yaku["ドラ"]).toBe("1飜");
    expect(result.yaku["赤ドラ"]).toBe("1飜");
    expect(result.dora).toBe(2);

    const noAka = MahjongHandEvaluator.evaluate(hand, [], "1z", true, {
      ...context,
      akaDora: false,
    });
    expect(noAka.dora).toBe(1);

    // 和了形でも役が無ければ isAgari は false
    const yakuless = MahjongHandEvaluator.evaluate(hand, [], "1z", false, context);
    expect(yakuless.isCompleteShape).toBe(true);
    expect(yakuless.isAgari).toBe(false);
  });

  test("待ち牌と和了形の判定（一般形・七対子・国士無双）", () => {
    expect(MahjongRules.waitingTiles(SHANPON_WAIT)).toEqual(["1z", "2z"]);
    expect(
      MahjongRules.waitingTiles([
        "1m",
        "2m",
        "3m",
        "4p",
        "5p",
        "6p",
        "7s",
        "8s",
        "9s",
        "2z",
        "2z",
        "4m",
        "5m",
      ]),
    ).toEqual(["3m", "6m"]);
    expect(
      MahjongRules.waitingTiles([
        "1m",
        "9m",
        "1p",
        "9p",
        "1s",
        "9s",
        "1z",
        "2z",
        "3z",
        "4z",
        "5z",
        "6z",
        "7z",
      ]),
    ).toHaveLength(13);
    expect(
      MahjongRules.waitingTiles([
        "1m",
        "1m",
        "2m",
        "2m",
        "3m",
        "3m",
        "4p",
        "4p",
        "5p",
        "5p",
        "6s",
        "6s",
        "7z",
      ]),
    ).toEqual(["7z"]);
    expect(
      MahjongRules.isCompleteHand([
        "1m",
        "1m",
        "2m",
        "2m",
        "3m",
        "3m",
        "4p",
        "4p",
        "5p",
        "5p",
        "6s",
        "6s",
        "7z",
        "7z",
      ]),
    ).toBe(true);
    // 七対子に同じ牌 4 枚は不可
    expect(
      MahjongRules.isCompleteHand([
        "1m",
        "1m",
        "1m",
        "1m",
        "2m",
        "2m",
        "3p",
        "3p",
        "4p",
        "4p",
        "5s",
        "5s",
        "7z",
        "7z",
      ]),
    ).toBe(false);
    expect(MahjongRules.waitingTiles(JUNK)).toEqual([]);
    // 副露がある手（10 枚）も判定できる
    expect(
      MahjongRules.waitingTiles(["4p", "5p", "6p", "7s", "8s", "9s", "1z", "1z", "2z", "2z"]),
    ).toEqual(["1z", "2z"]);
  });
});
