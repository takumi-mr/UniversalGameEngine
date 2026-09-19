// apps/frontend/src/sound/SoundDriver.ts
//
// Web Audio API の薄いラッパー（Vue 非依存、モジュールシングルトン）。
// - SE: fetch → decodeAudioData したバッファを AudioBufferSourceNode で鳴らす（低遅延・同時発音）
// - BGM: HTMLAudioElement でストリーミング再生（長尺をデコードしてメモリに置かない）
// - 音量: master / se / bgm の 3 段 + ミュート
// - 自動再生ポリシー: 最初のユーザー操作で AudioContext を resume し、保留中の BGM を流す
// - 音源が無い / デコードできない場合は src ごとに 1 回だけ警告して無音にする（ゲームは止めない）
//
// AudioContext が無い環境（jsdom、SSR）では全メソッドが no-op になる。
import type { BgmDef, SoundAssetDef } from "@/sound/types";

export interface SoundVolumes {
  master: number;
  se: number;
  bgm: number;
  muted: boolean;
}

const DEFAULT_POLYPHONY = 4;

interface SeSlot {
  def: SoundAssetDef;
  /** 最後に鳴らした時刻（performance.now 基準、ms） */
  lastPlayedAt: number;
  /** 再生中のソース数（同時発音制限用） */
  active: number;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

export class SoundDriver {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private seGain: GainNode | null = null;

  private volumes: SoundVolumes = { master: 1, se: 1, bgm: 1, muted: false };

  /** src → デコード済みバッファ。null はロード失敗（再試行しない） */
  private buffers = new Map<string, AudioBuffer | null>();
  private loading = new Map<string, Promise<void>>();
  private slots = new Map<string, SeSlot>();

  private bgmEl: HTMLAudioElement | null = null;
  private bgmKey: string | null = null;
  private bgmDef: BgmDef | null = null;

  private unlocked = false;
  private unlockListenersInstalled = false;

  /** ユーザー操作を受けて AudioContext を resume 済みか */
  get isUnlocked(): boolean {
    return this.unlocked;
  }

  /** この環境で音を出せるか（AudioContext がある） */
  get available(): boolean {
    return typeof window !== "undefined" && typeof window.AudioContext === "function";
  }

  // --- 初期化 / アンロック ---

  private ensureContext(): AudioContext | null {
    if (!this.available) return null;
    if (!this.ctx) {
      this.ctx = new window.AudioContext();
      this.masterGain = this.ctx.createGain();
      this.seGain = this.ctx.createGain();
      this.seGain.connect(this.masterGain);
      this.masterGain.connect(this.ctx.destination);
      this.applyVolumes();
    }
    this.installUnlockListeners();
    return this.ctx;
  }

  /**
   * ブラウザの自動再生制限: ユーザー操作（pointerdown / keydown）があるまで AudioContext は
   * suspended のままなので、最初の操作で resume し、保留中の BGM を鳴らす。
   */
  private installUnlockListeners(): void {
    if (this.unlockListenersInstalled || typeof window === "undefined") return;
    this.unlockListenersInstalled = true;
    const unlock = () => {
      this.unlocked = true;
      void this.ctx?.resume().catch(() => {});
      this.tryPlayBgmElement();
      window.removeEventListener("pointerdown", unlock, true);
      window.removeEventListener("keydown", unlock, true);
    };
    window.addEventListener("pointerdown", unlock, true);
    window.addEventListener("keydown", unlock, true);
  }

  // --- 音量 ---

  setVolumes(volumes: SoundVolumes): void {
    this.volumes = {
      master: clamp01(volumes.master),
      se: clamp01(volumes.se),
      bgm: clamp01(volumes.bgm),
      muted: volumes.muted,
    };
    this.applyVolumes();
  }

  private applyVolumes(): void {
    const { master, se, bgm, muted } = this.volumes;
    if (this.masterGain) this.masterGain.gain.value = muted ? 0 : master;
    if (this.seGain) this.seGain.gain.value = se;
    if (this.bgmEl) {
      this.bgmEl.volume = muted ? 0 : clamp01(master * bgm * (this.bgmDef?.volume ?? 1));
    }
  }

  // --- SE ---

  /** 効果音を登録して先読みする。同じ src は 1 回しかロードしない */
  preload(defs: Record<string, SoundAssetDef>): Promise<void> {
    const ctx = this.ensureContext();
    for (const [key, def] of Object.entries(defs)) {
      const existing = this.slots.get(key);
      this.slots.set(key, { def, lastPlayedAt: -Infinity, active: existing?.active ?? 0 });
    }
    if (!ctx) return Promise.resolve();
    return Promise.all(Object.values(defs).map((d) => this.loadBuffer(ctx, d.src))).then(() => {});
  }

  private loadBuffer(ctx: AudioContext, src: string): Promise<void> {
    if (this.buffers.has(src)) return Promise.resolve();
    const inflight = this.loading.get(src);
    if (inflight) return inflight;
    const p = fetch(src)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.arrayBuffer();
      })
      .then((data) => ctx.decodeAudioData(data))
      .then((buffer) => {
        this.buffers.set(src, buffer);
      })
      .catch((err: unknown) => {
        // 音源が未配置でもゲームは動かす。同じ src で何度も警告しない
        if (!this.buffers.has(src)) {
          this.buffers.set(src, null);
          const reason = err instanceof Error ? err.message : String(err);
          console.warn(`[Sound] 音源をロードできません: ${src} (${reason})`);
        }
      })
      .finally(() => this.loading.delete(src));
    this.loading.set(src, p);
    return p;
  }

  /**
   * 効果音を鳴らす。未登録キー・未ロード・クールダウン中・同時発音上限のときは何もしない。
   * @returns 実際に再生をスケジュールしたか
   */
  playSE(key: string, delayMs = 0): boolean {
    const slot = this.slots.get(key);
    const ctx = this.ctx;
    if (!slot || !ctx || !this.masterGain || !this.seGain) return false;
    const buffer = this.buffers.get(slot.def.src);
    if (!buffer) return false;

    const now = performance.now();
    const cooldown = slot.def.cooldownMs ?? 0;
    if (cooldown > 0 && now - slot.lastPlayedAt < cooldown) return false;
    if (slot.active >= (slot.def.maxPolyphony ?? DEFAULT_POLYPHONY)) return false;

    slot.lastPlayedAt = now;
    slot.active++;

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const gain = ctx.createGain();
    gain.gain.value = clamp01(slot.def.volume ?? 1);
    source.connect(gain);
    gain.connect(this.seGain);
    source.onended = () => {
      slot.active = Math.max(0, slot.active - 1);
      source.disconnect();
      gain.disconnect();
    };
    source.start(ctx.currentTime + Math.max(0, delayMs) / 1000);
    return true;
  }

  hasSE(key: string): boolean {
    return this.slots.has(key);
  }

  // --- BGM ---

  /** BGM を流す。同じキーが既に流れていれば何もしない（別の曲なら止めて差し替える） */
  playBGM(key: string, def: BgmDef): void {
    if (!this.available) return;
    if (this.bgmKey === key) return;
    this.stopBGM();
    this.ensureContext();

    const el = new Audio(def.src);
    el.loop = def.loop ?? true;
    el.preload = "auto";
    el.addEventListener("error", () => {
      console.warn(`[Sound] BGM をロードできません: ${def.src}`);
    });
    this.bgmEl = el;
    this.bgmKey = key;
    this.bgmDef = def;
    this.applyVolumes();
    this.tryPlayBgmElement();
  }

  private tryPlayBgmElement(): void {
    const el = this.bgmEl;
    if (!el) return;
    // 自動再生が拒否されたら、アンロック時（ユーザー操作）にもう一度呼ばれる
    el.play().catch(() => {});
  }

  stopBGM(): void {
    if (this.bgmEl) {
      this.bgmEl.pause();
      this.bgmEl.removeAttribute("src");
      this.bgmEl.load();
    }
    this.bgmEl = null;
    this.bgmKey = null;
    this.bgmDef = null;
  }

  get currentBGM(): string | null {
    return this.bgmKey;
  }

  // --- 破棄 ---

  /** BGM を止め、登録した効果音とバッファを捨てる（AudioContext とアンロック状態は保持） */
  unloadAll(): void {
    this.stopBGM();
    this.slots.clear();
    this.buffers.clear();
    this.loading.clear();
  }

  /** テスト用: 状態を完全に初期化する */
  resetForTests(): void {
    this.unloadAll();
    void this.ctx?.close().catch(() => {});
    this.ctx = null;
    this.masterGain = null;
    this.seGain = null;
    this.unlocked = false;
    this.unlockListenersInstalled = false;
  }
}

export const soundDriver = new SoundDriver();
