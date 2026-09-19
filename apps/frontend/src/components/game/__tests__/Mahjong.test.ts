// apps/frontend/src/components/game/__tests__/Mahjong.test.ts
// 卓の配線を検証する: 合法手 → 3D 側に渡す選択可能牌と操作ボタン、牌クリック → DISCARD / RIICHI、
// 割り込み（ポン）ボタン → CALL、対局（MahjongMatch）では SUBGAME_ACTION に包まれること。
// Three.js は jsdom で動かないので MahjongUI をスタブに差し替える。
import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import { createI18n } from "vue-i18n";
import { createVuetify } from "vuetify";
import * as components from "vuetify/components";
import { UniversalEngine } from "@engine/shared/UniversalEngine";
import { createSecret } from "@engine/shared/GameRules";
import "@engine/shared/GameRegistry";
import {
  MahjongRuleset,
  type MahjongAction,
  type MahjongState,
  type Tile,
} from "@engine/shared/rules/mahjong/MahjongRuleset";
import {
  MahjongMatchRuleset,
  type MahjongMatchAction,
  type MahjongMatchState,
} from "@engine/shared/rules/mahjong/MahjongMatchRuleset";
import ja from "@/i18n/locales/ja.json";
import Mahjong from "@/components/game/Mahjong.vue";
import MahjongMatch from "@/components/game/MahjongMatch.vue";

// --- MahjongUI スタブ: renderState の引数と牌クリックのコールバックを記録する ---
const stub = vi.hoisted(() => ({
  renderCalls: [] as { viewerId: string; selectable: Tile[] }[],
  onTileClick: null as ((tile: Tile, index: number) => void) | null,
}));

vi.mock("@/three/MahjongUI", () => ({
  MahjongUI: class {
    constructor(_container: HTMLElement, onTileClick: (tile: Tile, index: number) => void) {
      stub.onTileClick = onTileClick;
    }
    renderState(_state: MahjongState, viewerId: string, options?: { selectableTiles?: Tile[] }) {
      stub.renderCalls.push({ viewerId, selectable: options?.selectableTiles ?? [] });
    }
    dispose() {}
  },
}));

const P = ["p1", "p2", "p3", "p4"];
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
const JUNK: Tile[] = ["1m", "4m", "7m", "1p", "4p", "7p", "1s", "4s", "7s", "3z", "4z", "5z", "6z"];

function startedHand() {
  const engine = new UniversalEngine<MahjongState, MahjongAction>(MahjongRuleset, {
    clientSeed: "c",
    serverSeed: "s",
  });
  for (const id of P) engine.dispatch({ type: "JOIN", playerId: id });
  engine.dispatch({ type: "START", playerId: "p1" });
  return engine;
}

/** 手牌を差し替える（親は 14 枚、他は 13 枚） */
function rig(engine: UniversalEngine<MahjongState, MahjongAction>, hands: Record<string, Tile[]>) {
  const state = structuredClone(engine.getState());
  for (const [id, tiles] of Object.entries(hands)) {
    state.hands[id] = createSecret(tiles, [id], Array(tiles.length).fill("?"));
  }
  engine.loadState(state, engine.getReplayData());
}

const plugins = () => [
  createI18n({ legacy: false, locale: "ja", messages: { ja } }),
  createVuetify({ components }),
];

const lastRender = () => stub.renderCalls[stub.renderCalls.length - 1]!;
const buttonLabels = (wrapper: ReturnType<typeof mount>) =>
  wrapper.findAll(".action-btn").map((b) => b.text());
const clickButton = async (wrapper: ReturnType<typeof mount>, label: string) => {
  const button = wrapper.findAll(".action-btn").find((b) => b.text() === label);
  expect(button, `button "${label}"`).toBeDefined();
  await button!.trigger("click");
};

beforeEach(() => {
  stub.renderCalls = [];
  stub.onTileClick = null;
});

describe("Mahjong.vue（1 局戦）", () => {
  const mountAs = (engine: UniversalEngine<MahjongState, MahjongAction>, me: string) =>
    mount(Mahjong, {
      props: { state: engine.getMaskedState(me), myPlayerId: me },
      global: { plugins: plugins() },
    });

  it("手番の親には打牌できる牌が選択可能として 3D 側に渡り、クリックで DISCARD を送る", async () => {
    const engine = startedHand();
    const wrapper = mountAs(engine, "p1");
    await nextTick();

    const hand = engine.getState().hands.p1.value;
    expect(lastRender().viewerId).toBe("p1");
    expect(new Set(lastRender().selectable)).toEqual(new Set(hand));

    stub.onTileClick!(hand[0]!, 0);
    expect(wrapper.emitted("action")).toEqual([
      [{ type: "DISCARD", tile: hand[0], playerId: "p1" }],
    ]);
  });

  it("手番でない子は牌を選べず、操作ボタンも出ない", async () => {
    const wrapper = mountAs(startedHand(), "p2");
    await nextTick();
    expect(lastRender().selectable).toEqual([]);
    expect(buttonLabels(wrapper)).toEqual([]);
    stub.onTileClick!("1m", 0);
    expect(wrapper.emitted("action")).toBeUndefined();
  });

  it("聴牌ならリーチボタンが出て、宣言牌を選ぶと RIICHI を送る", async () => {
    const engine = startedHand();
    rig(engine, { p1: [...SHANPON_WAIT, "9m"] });
    const wrapper = mountAs(engine, "p1");
    await nextTick();

    expect(buttonLabels(wrapper)).toContain("リーチ");
    await clickButton(wrapper, "リーチ");
    expect(lastRender().selectable).toEqual(["9m"]);
    expect(buttonLabels(wrapper)).toEqual(["キャンセル"]);

    stub.onTileClick!("9m", 13);
    expect(wrapper.emitted("action")).toEqual([[{ type: "RIICHI", tile: "9m", playerId: "p1" }]]);
  });

  it("他家の打牌にポンできるときはボタンが出て、CALL を送る", async () => {
    const engine = startedHand();
    rig(engine, { p1: [...JUNK, "1z"], p2: SHANPON_WAIT.slice(0, 11).concat(["3z", "4z"]) });
    engine.dispatch({ type: "DISCARD", playerId: "p1", tile: "1z" });
    expect(engine.getState().phase).toBe("INTERRUPTING");

    const wrapper = mountAs(engine, "p2");
    await nextTick();
    expect(wrapper.text()).toContain("p1 が 東 を捨てました");
    expect(buttonLabels(wrapper)).toEqual(["ポン 東 東", "パス"]);

    await clickButton(wrapper, "ポン 東 東");
    expect(wrapper.emitted("action")).toEqual([
      [{ type: "CALL", meldType: "PON", consumed: ["1z", "1z"], playerId: "p2" }],
    ]);
  });

  it("局が終わると結果が表示される", async () => {
    const engine = startedHand();
    rig(engine, { p1: [...SHANPON_WAIT, "1z"] });
    engine.dispatch({ type: "TSUMO", playerId: "p1" });
    expect(engine.getState().result?.type).toBe("WIN");

    const wrapper = mountAs(engine, "p3");
    await nextTick();
    expect(wrapper.find(".result-card").text()).toContain("和了");
    expect(wrapper.find(".result-card").text()).toContain("ツモ");
  });
});

describe("MahjongMatch.vue（対局）", () => {
  it("現在局を卓に渡し、打牌は SUBGAME_ACTION に包んで送る", async () => {
    const engine = new UniversalEngine<MahjongMatchState, MahjongMatchAction>(MahjongMatchRuleset, {
      clientSeed: "c",
      serverSeed: "s",
    });
    for (const id of P) engine.dispatch({ type: "JOIN", playerId: id });
    engine.dispatch({ type: "START", playerId: "p1" });

    const wrapper = mount(MahjongMatch, {
      props: { state: engine.getMaskedState("p1"), myPlayerId: "p1" },
      global: { plugins: plugins() },
    });
    await nextTick();

    const hand = (engine.getState().currentGame.state as MahjongState).hands.p1.value;
    expect(new Set(lastRender().selectable)).toEqual(new Set(hand));
    expect(wrapper.text()).toContain("半荘戦");

    stub.onTileClick!(hand[0]!, 0);
    expect(wrapper.emitted("action")).toEqual([
      [
        {
          type: "SUBGAME_ACTION",
          subAction: { type: "DISCARD", tile: hand[0], playerId: "p1" },
          playerId: "p1",
        },
      ],
    ]);
  });
});
