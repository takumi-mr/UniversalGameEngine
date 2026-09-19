import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { defineComponent, h, nextTick, ref, type Ref } from "vue";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import type { BaseGameAction, BaseGameState } from "@engine/shared/GameRules";
import {
  OthelloRuleset,
  type OthelloAction,
  type OthelloState,
} from "@engine/shared/rules/OthelloRuleset";
import { withTestRng } from "@engine/shared/testing/withTestRng";
import { soundDriver } from "@/sound/SoundDriver";
import { useGameSound } from "@/sound/useGameSound";

const rules = withTestRng(OthelloRuleset);

function started(): OthelloState {
  const state = rules.getInitialState();
  state.status = "PLAYING";
  state.players = { 1: "black", [-1]: "white" };
  state.activePlayers = ["black"];
  state.version = 3;
  return state;
}

// composable を使うだけの最小コンポーネント
function mountWith(state: Ref<BaseGameState | null>, lastAction: Ref<BaseGameAction | null>) {
  let ready: Promise<void> = Promise.resolve();
  const Host = defineComponent({
    setup() {
      ready = useGameSound({
        gameType: "othello",
        state,
        lastAction,
        myPlayerId: () => "white",
        mode: "live",
      }).ready;
      return () => h("div");
    },
  });
  const wrapper = mount(Host);
  return { wrapper, ready: () => ready };
}

const flush = () => nextTick();

describe("useGameSound", () => {
  // 鳴らしたキーを集めるための spy
  const playedKeys: string[] = [];
  let playBGM: ReturnType<typeof vi.spyOn>;
  let stopBGM: ReturnType<typeof vi.spyOn>;
  let unloadAll: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    setActivePinia(createPinia());
    vi.spyOn(soundDriver, "preload").mockResolvedValue();
    playedKeys.length = 0;
    vi.spyOn(soundDriver, "playSE").mockImplementation((key) => {
      playedKeys.push(key);
      return true;
    });
    playBGM = vi.spyOn(soundDriver, "playBGM").mockImplementation(() => {});
    stopBGM = vi.spyOn(soundDriver, "stopBGM").mockImplementation(() => {});
    unloadAll = vi.spyOn(soundDriver, "unloadAll").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it("共通イベント + ゲーム固有の onAction を評価し、BGM を切り替え、破棄時に片付ける", async () => {
    const state = ref<BaseGameState | null>(null);
    const lastAction = ref<BaseGameAction | null>(null);
    const { wrapper, ready } = mountWith(state, lastAction);
    await ready(); // プロファイルの遅延ロード（import()）を待つ

    // 最初の状態: 効果音は鳴らさず BGM だけ
    const s0 = started();
    state.value = s0;
    await flush();
    expect(playedKeys).toEqual([]);
    expect(playBGM).toHaveBeenCalledWith(
      "main",
      expect.objectContaining({ src: expect.any(String) }),
    );

    // 黒が着手 → 白（自分）の手番: place / flip（ゲーム固有）+ my_turn（共通）
    const action: OthelloAction = { type: "PLACE_PIECE", x: 2, y: 3, color: 1, playerId: "black" };
    const s1 = { ...rules.reduce(s0, action), version: 4 };
    lastAction.value = action;
    state.value = s1;
    await flush();
    expect(playedKeys).toEqual(expect.arrayContaining(["my_turn", "place", "flip"]));

    // 同じ version の再送（再同期）では鳴らさない
    playedKeys.length = 0;
    state.value = { ...s1 };
    await flush();
    expect(playedKeys).toEqual([]);

    // 終局（黒の勝ち）: 自分は白なので defeat、BGM 停止
    lastAction.value = null;
    state.value = { ...s1, status: "FINISHED", activePlayers: [], version: 5 };
    await flush();
    expect(playedKeys).toContain("defeat");
    expect(stopBGM).toHaveBeenCalled();

    wrapper.unmount();
    expect(unloadAll).toHaveBeenCalled();
  });
});
