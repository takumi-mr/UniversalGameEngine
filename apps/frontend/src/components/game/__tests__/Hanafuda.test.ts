// apps/frontend/src/components/game/__tests__/Hanafuda.test.ts
// 画面の配線を検証する: サーバー（マスク済み）状態の表示と、手札クリック → PLAY_CARD の送信。
import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import Hanafuda from "@/components/game/Hanafuda.vue";
import { UniversalEngine } from "@engine/shared/UniversalEngine";
import {
  HanafudaRuleset,
  type HanafudaAction,
  type HanafudaState,
} from "@engine/shared/rules/HanafudaRuleset";

const [A, B] = ["alice", "bob"];

function startedEngine() {
  const engine = new UniversalEngine<HanafudaState, HanafudaAction>(HanafudaRuleset, {
    clientSeed: "c",
    serverSeed: "s",
  });
  engine.dispatch({ type: "JOIN", playerId: A });
  engine.dispatch({ type: "JOIN", playerId: B });
  engine.dispatch({ type: "START", playerId: A });
  return engine;
}

const mountAs = (engine: ReturnType<typeof startedEngine>, me: string) =>
  mount(Hanafuda, { props: { state: engine.getMaskedState(me), myPlayerId: me } });

describe("Hanafuda.vue", () => {
  it("自分の手札 8 枚は表向き、相手の手札 8 枚は伏せて表示される", () => {
    const wrapper = mountAs(startedEngine(), A);
    expect(wrapper.findAll(".card.my-hand")).toHaveLength(8);
    expect(wrapper.findAll(".card.hidden")).toHaveLength(8);
    expect(wrapper.findAll(".card.field")).toHaveLength(8);
    expect(wrapper.text()).toContain("手札から札を出してください");
  });

  it("手番の手札をクリックすると PLAY_CARD を送る", async () => {
    const engine = startedEngine();
    const wrapper = mountAs(engine, A);
    const card = engine.getState().hands[A].value[0];

    await wrapper.findAll(".card.my-hand")[0].trigger("click");

    expect(wrapper.emitted("action")).toEqual([[{ type: "PLAY_CARD", card, playerId: A }]]);
  });

  it("手番でないプレイヤーの手札クリックは何も送らない", async () => {
    const wrapper = mountAs(startedEngine(), B);
    await wrapper.findAll(".card.my-hand")[0].trigger("click");
    expect(wrapper.emitted("action")).toBeUndefined();
    expect(wrapper.text()).not.toContain("手札から札を出してください");
  });

  it("開始前（配札前）の状態でも描画できる", () => {
    const engine = new UniversalEngine<HanafudaState, HanafudaAction>(HanafudaRuleset, {});
    engine.dispatch({ type: "JOIN", playerId: A });
    const wrapper = mountAs(engine, A);
    expect(wrapper.findAll(".card.my-hand")).toHaveLength(0);
  });
});
