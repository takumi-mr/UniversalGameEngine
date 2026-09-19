import { describe, it, expect, beforeEach, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useSoundStore } from "@/store/sound";
import { soundDriver } from "@/sound/SoundDriver";

describe("useSoundStore", () => {
  beforeEach(() => {
    localStorage.clear();
    setActivePinia(createPinia());
  });

  it("保存された設定がなければ既定値", () => {
    const store = useSoundStore();
    expect(store.masterVolume).toBe(0.8);
    expect(store.seVolume).toBe(1);
    expect(store.bgmVolume).toBe(0.5);
    expect(store.muted).toBe(false);
  });

  it("音量・ミュートの変更は localStorage に保存され、SoundDriver に反映される", () => {
    const spy = vi.spyOn(soundDriver, "setVolumes");
    const store = useSoundStore();
    store.setMasterVolume(0.3);
    store.setBgmVolume(2); // 範囲外は丸める
    store.toggleMuted();
    expect(store.masterVolume).toBe(0.3);
    expect(store.bgmVolume).toBe(1);
    expect(store.muted).toBe(true);
    expect(JSON.parse(localStorage.getItem("sound-settings")!)).toEqual({
      masterVolume: 0.3,
      seVolume: 1,
      bgmVolume: 1,
      muted: true,
    });
    expect(spy).toHaveBeenLastCalledWith({ master: 0.3, se: 1, bgm: 1, muted: true });
    spy.mockRestore();
  });

  it("localStorage の値を初期状態として読み込み、壊れた値は既定値に戻す", () => {
    localStorage.setItem(
      "sound-settings",
      JSON.stringify({ masterVolume: 0.2, seVolume: "loud", bgmVolume: -1, muted: true }),
    );
    const store = useSoundStore();
    expect(store.masterVolume).toBe(0.2);
    expect(store.seVolume).toBe(1); // 型が違う → 既定値
    expect(store.bgmVolume).toBe(0); // 範囲外 → 丸め
    expect(store.muted).toBe(true);

    localStorage.setItem("sound-settings", "{not json");
    setActivePinia(createPinia());
    expect(useSoundStore().masterVolume).toBe(0.8);
  });
});
