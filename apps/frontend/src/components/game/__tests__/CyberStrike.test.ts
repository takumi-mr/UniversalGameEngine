// apps/frontend/src/components/game/__tests__/CyberStrike.test.ts
// 画面の配線を検証する: キー入力 → 予測 INPUT の送信、無入力時のハートビート、
// サーバー確定状態の取り込みと予測時点への進め直し、PLAY AGAIN の RESET。
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import CyberStrike from "@/components/game/CyberStrike.vue";
import { UniversalEngine } from "@engine/shared/UniversalEngine";
import {
  CyberStrikeRuleset,
  BOT_ID,
  TICK_RATE,
  type CyberStrikeAction,
  type CyberStrikeState,
} from "@engine/shared/rules/CyberStrikeRuleset";

const ME = "alice";
const T0 = 1_700_000_000_000;

/** サーバー役: alice が着席して自動開始した状態（相手は CPU） */
function serverEngine() {
  const engine = new UniversalEngine<CyberStrikeState, CyberStrikeAction>(CyberStrikeRuleset, {
    clientSeed: "c",
    serverSeed: "s",
  });
  engine.dispatch({ type: "JOIN", playerId: ME });
  engine.dispatch({ type: "START", playerId: ME, timestamp: T0 });
  return engine;
}

function mountGame(state: CyberStrikeState) {
  return mount(CyberStrike, {
    props: { state, gameId: "g1", myPlayerId: ME, clockSkew: 0 },
    attachTo: document.body,
  });
}

const emittedActions = (wrapper: ReturnType<typeof mountGame>) =>
  (wrapper.emitted("action") ?? []).map((args) => args[0] as CyberStrikeAction);

const key = (type: "keydown" | "keyup", k: string) =>
  window.dispatchEvent(new KeyboardEvent(type, { key: k }));

describe("CyberStrike.vue", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    // jsdom には canvas が無いので描画はスキップされる
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    vi.spyOn(window, "requestAnimationFrame").mockImplementation(() => 0);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("サーバー状態を即座に取り込み、HUD に両者と CPU が出る", async () => {
    const server = serverEngine();
    const wrapper = mountGame(server.getState());
    await nextTick();
    vi.advanceTimersByTime(30); // 既定の人工遅延（RTT 50ms → 片道 25ms）を待つ
    await nextTick();
    expect(wrapper.text()).toContain(ME);
    expect(wrapper.text()).toContain(BOT_ID);
    expect(wrapper.text()).toContain("PLAYING");
    wrapper.unmount();
  });

  it("キーを押すと予測 INPUT を即座に適用してサーバーへ送り、離すと移動 0 の INPUT を送る", async () => {
    const server = serverEngine();
    const wrapper = mountGame(server.getState());
    await nextTick();
    // 人工遅延を 0 にする
    const zero = wrapper.findAll(".ping-btn").find((b) => b.text() === "0ms")!;
    await zero.trigger("click");

    key("keydown", "d");
    vi.advanceTimersByTime(1000 / TICK_RATE + 1); // 固定更新 1 回
    let actions = emittedActions(wrapper);
    expect(actions.length).toBe(1);
    expect(actions[0].type).toBe("INPUT");
    expect(actions[0]).toMatchObject({ playerId: ME, input: { moveX: 1, moveY: 0 } });
    expect((actions[0] as { seq?: number }).seq).toBe(1);
    expect((actions[0] as { timestamp?: number }).timestamp).toBeGreaterThanOrEqual(T0);

    // 押し続けても同じ入力は再送しない
    vi.advanceTimersByTime(60);
    expect(emittedActions(wrapper).filter((a) => a.type === "INPUT").length).toBe(1);

    key("keyup", "d");
    vi.advanceTimersByTime(1000 / TICK_RATE + 1);
    actions = emittedActions(wrapper).filter((a) => a.type === "INPUT");
    expect(actions.length).toBe(2);
    expect(actions[1]).toMatchObject({ input: { moveX: 0, moveY: 0 } });
    wrapper.unmount();
  });

  it("入力が無い間は 100ms ごとにハートビート（TICK）を送り、ローカルの物理は時刻で進む", async () => {
    const server = serverEngine();
    const wrapper = mountGame(server.getState());
    await nextTick();
    await wrapper
      .findAll(".ping-btn")
      .find((b) => b.text() === "0ms")!
      .trigger("click");

    vi.advanceTimersByTime(1000);
    // 固定更新（33ms）の粒度で 100ms 以上空いたら送るので、1 秒に 7〜8 回
    const ticks = emittedActions(wrapper).filter((a) => a.type === "TICK");
    expect(ticks.length).toBeGreaterThanOrEqual(6);
    expect(ticks.length).toBeLessThanOrEqual(10);
    expect(ticks.every((t) => (t as { timestamp?: number }).timestamp! >= T0)).toBe(true);
    // ローカルは 1 秒ぶん（30 ティック前後）進んでいる
    const vm = wrapper.vm as unknown as { currentState: CyberStrikeState };
    expect(vm.currentState.tick).toBeGreaterThanOrEqual(27);
    expect(vm.currentState.tick).toBeLessThanOrEqual(31);
    wrapper.unmount();
  });

  it("サーバー確定状態が届くと巻き戻して未処理の入力を再適用し、予測していたティックまで進め直す", async () => {
    const server = serverEngine();
    const wrapper = mountGame(server.getState());
    await nextTick();
    await wrapper
      .findAll(".ping-btn")
      .find((b) => b.text() === "0ms")!
      .trigger("click");

    key("keydown", "d");
    vi.advanceTimersByTime(1000 / TICK_RATE + 1);
    const input = emittedActions(wrapper)[0];
    vi.advanceTimersByTime(300); // ローカルは先へ進んでいる

    // サーバーが入力を処理（少し遅れて）
    server.dispatch({ ...input, timestamp: T0 + 60 });
    server.dispatch({ type: "TICK", timestamp: T0 + 200 });
    const serverState = server.getState();
    expect(serverState.playersData[ME].lastProcessedSeq).toBe(1);

    await wrapper.setProps({ state: serverState });
    await nextTick();
    vi.advanceTimersByTime(1); // reconcile は人工遅延 0 なら同期

    // 自機は右へ動いている（ローカルで予測された位置）。時刻はサーバーより先のまま
    const vm = wrapper.vm as unknown as {
      currentState: CyberStrikeState;
      metrics: { pendingActionsCount: number };
    };
    expect(vm.currentState.playersData[ME].x).toBeGreaterThan(120);
    expect(vm.currentState.tick).toBeGreaterThan(serverState.tick);
    expect(vm.metrics.pendingActionsCount).toBe(0); // seq 1 は確定済み
    wrapper.unmount();
  });

  it("終局後の PLAY AGAIN は RESET を送る（ローカルでは予測しない）", async () => {
    const server = serverEngine();
    const finished = { ...server.getState(), status: "FINISHED" as const, message: "done" };
    const wrapper = mountGame(finished);
    await nextTick();
    await wrapper
      .findAll(".ping-btn")
      .find((b) => b.text() === "0ms")!
      .trigger("click");
    const again = wrapper.findAll("button").find((b) => b.text().includes("PLAY AGAIN"))!;
    await again.trigger("click");
    const actions = emittedActions(wrapper);
    expect(actions.map((a) => a.type)).toEqual(["RESET"]);
    wrapper.unmount();
  });
});
