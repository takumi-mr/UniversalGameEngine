import { expect, test, describe } from "bun:test";
import { DaifugoRuleset as RealDaifugoRuleset, type DaifugoState } from "../DaifugoRuleset";
import { createSecret } from "../../GameRules";
import { assertDeterministic } from "../../testing/assertDeterministic";
import { withTestRng } from "../../testing/withTestRng";

// ルールセットを直接呼ぶテストなので、固定シードの RNG を補う
const DaifugoRuleset = withTestRng(RealDaifugoRuleset);
const PLAYERS = ["p1", "p2", "p3", "p4"];

/** 指定した手札の PLAYING 状態を組み立てる（配札のシャッフルはテストに不要なので直接差し替える） */
function stateWithHands(
  hands: Record<string, string[]>,
  overrides: Partial<DaifugoState> = {},
): DaifugoState {
  const base = DaifugoRuleset.getInitialState({ playerIds: PLAYERS, ...overrides });
  const secretHands = Object.fromEntries(
    Object.entries(hands).map(([pId, cards]) => [pId, createSecret(cards, [pId])]),
  );
  return {
    ...base,
    ...overrides,
    status: "PLAYING",
    hands: { ...base.hands, ...secretHands },
    activePlayers: ["p1"],
  };
}

describe("DaifugoRuleset ローカルルール（feature flag）", () => {
  test("デフォルト（フラグ無効）では 8 を出しても場は流れず、次の人に手番が移る", () => {
    const state = stateWithHands({
      p1: ["8S", "3S"],
      p2: ["4S"],
      p3: ["4H"],
      p4: ["4D"],
    });

    const next = DaifugoRuleset.reduce(state, { type: "PLAY", playerId: "p1", cards: ["8S"] });

    expect(next.tableCards).toEqual(["8S"]);
    expect(next.activePlayers).toEqual(["p2"]);
  });

  test("eightGiri 有効時: 8 を出すと場が流れ、上がっていなければ同じプレイヤーの手番が続く", () => {
    const state = stateWithHands(
      {
        p1: ["8S", "3S"],
        p2: ["4S"],
        p3: ["4H"],
        p4: ["4D"],
      },
      { eightGiri: true },
    );

    const next = DaifugoRuleset.reduce(state, { type: "PLAY", playerId: "p1", cards: ["8S"] });

    expect(next.tableCards).toEqual([]);
    expect(next.lastPlayedPlayerId).toBeNull();
    expect(next.activePlayers).toEqual(["p1"]);
  });

  test("eightGiri 有効時: 8 を出して上がった場合は次の生存プレイヤーに手番が移る", () => {
    const state = stateWithHands(
      {
        p1: ["8S"],
        p2: ["4S"],
        p3: ["4H"],
        p4: ["4D"],
      },
      { eightGiri: true },
    );

    const next = DaifugoRuleset.reduce(state, { type: "PLAY", playerId: "p1", cards: ["8S"] });

    expect(next.tableCards).toEqual([]);
    expect(next.ranks).toEqual(["p1"]);
    expect(next.activePlayers).toEqual(["p2"]);
  });

  test("kakumei 無効時は 4 枚出しをしても強弱は反転しない", () => {
    const state = stateWithHands({
      p1: ["4S", "4H", "4D", "4C"],
      p2: ["3S"],
      p3: [],
      p4: [],
    });

    const afterQuad = DaifugoRuleset.reduce(state, {
      type: "PLAY",
      playerId: "p1",
      cards: ["4S", "4H", "4D", "4C"],
    });
    expect(afterQuad.revolution).toBe(false);
  });

  test("kakumei 有効時: 4 枚以上の同ランク出しで、以後の場に対する強弱が反転する", () => {
    const state = stateWithHands(
      {
        p1: ["4S", "4H", "4D", "4C"],
        p2: ["3S", "5S"],
        p3: [],
        p4: [],
      },
      { kakumei: true },
    );

    const afterQuad = DaifugoRuleset.reduce(state, {
      type: "PLAY",
      playerId: "p1",
      cards: ["4S", "4H", "4D", "4C"],
    });
    expect(afterQuad.revolution).toBe(true);
    expect(afterQuad.activePlayers).toEqual(["p2"]);

    // 革命中、場に「5」が出ていれば数字の小さい「3」が勝てる
    const tableFive: DaifugoState = { ...afterQuad, tableCards: ["5S"] };
    expect(
      DaifugoRuleset.isValidAction(tableFive, { type: "PLAY", playerId: "p2", cards: ["3S"] }),
    ).toBe(true);

    // 革命が無ければ同じ場面で「3」は「5」に勝てない（比較用）
    const tableFiveNoRevolution: DaifugoState = { ...tableFive, revolution: false };
    expect(
      DaifugoRuleset.isValidAction(tableFiveNoRevolution, {
        type: "PLAY",
        playerId: "p2",
        cards: ["3S"],
      }),
    ).toBe(false);
  });

  test("kakumei 有効時: もう一度 4 枚以上の同ランク出しをすると強弱が元に戻る", () => {
    let state = stateWithHands(
      {
        p1: ["4S", "4H", "4D", "4C"],
        p2: ["5S", "5H", "5D", "5C"],
        p3: [],
        p4: [],
      },
      { kakumei: true },
    );

    state = DaifugoRuleset.reduce(state, {
      type: "PLAY",
      playerId: "p1",
      cards: ["4S", "4H", "4D", "4C"],
    });
    expect(state.revolution).toBe(true);

    state = DaifugoRuleset.reduce(state, {
      type: "PLAY",
      playerId: "p2",
      cards: ["5S", "5H", "5D", "5C"],
    });
    expect(state.revolution).toBe(false);
  });

  test("フラグを有効にしても決定論的である（assertDeterministic）", () => {
    assertDeterministic({
      rules: RealDaifugoRuleset,
      options: {
        clientSeed: "daifugo-seed-A",
        serverSeed: "daifugo-server-A",
        players: PLAYERS,
        playerIds: PLAYERS,
        kakumei: true,
        eightGiri: true,
      },
      playerIds: PLAYERS,
      maxSteps: 60,
    });
  });
});
