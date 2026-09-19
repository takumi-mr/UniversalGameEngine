import { defineStore } from "pinia";
import { soundDriver } from "@/sound/SoundDriver";

const STORAGE_KEY = "sound-settings";

interface SoundSettings {
  masterVolume: number;
  seVolume: number;
  bgmVolume: number;
  muted: boolean;
}

const DEFAULTS: SoundSettings = { masterVolume: 0.8, seVolume: 1, bgmVolume: 0.5, muted: false };

const clamp01 = (v: unknown, fallback: number) =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : fallback;

function loadSettings(): SoundSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return { ...DEFAULTS };
    const p = parsed as Partial<Record<keyof SoundSettings, unknown>>;
    return {
      masterVolume: clamp01(p.masterVolume, DEFAULTS.masterVolume),
      seVolume: clamp01(p.seVolume, DEFAULTS.seVolume),
      bgmVolume: clamp01(p.bgmVolume, DEFAULTS.bgmVolume),
      muted: typeof p.muted === "boolean" ? p.muted : DEFAULTS.muted,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

/**
 * サウンドのユーザー設定（音量・ミュート）。localStorage に永続化し、変更のたびに SoundDriver へ反映する。
 * どのゲームの音を鳴らすか（プロファイル）は画面のライフサイクルに紐づくので `useGameSound` が持つ。
 */
export const useSoundStore = defineStore("sound", {
  state: (): SoundSettings => loadSettings(),
  actions: {
    /** 起動時・設定変更時に SoundDriver へ音量を反映する */
    sync() {
      soundDriver.setVolumes({
        master: this.masterVolume,
        se: this.seVolume,
        bgm: this.bgmVolume,
        muted: this.muted,
      });
    },
    persist() {
      const data: SoundSettings = {
        masterVolume: this.masterVolume,
        seVolume: this.seVolume,
        bgmVolume: this.bgmVolume,
        muted: this.muted,
      };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      } catch {
        // localStorage が使えない環境（プライベートモード等）では保存しない
      }
      this.sync();
    },
    setMasterVolume(v: number) {
      this.masterVolume = clamp01(v, DEFAULTS.masterVolume);
      this.persist();
    },
    setSeVolume(v: number) {
      this.seVolume = clamp01(v, DEFAULTS.seVolume);
      this.persist();
    },
    setBgmVolume(v: number) {
      this.bgmVolume = clamp01(v, DEFAULTS.bgmVolume);
      this.persist();
    },
    setMuted(muted: boolean) {
      this.muted = muted;
      this.persist();
    },
    toggleMuted() {
      this.setMuted(!this.muted);
    },
    /**
     * 画面側から即時に効果音を鳴らす（ボタン操作のフィードバックなど）。
     * キーは現在ロード中のゲームプロファイル / 共通音から解決される。
     */
    playSE(key: string) {
      soundDriver.playSE(key);
    },
  },
});
