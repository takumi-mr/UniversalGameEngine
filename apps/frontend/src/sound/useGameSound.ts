// apps/frontend/src/sound/useGameSound.ts
//
// 画面（対局 / リプレイ）のライフサイクルに合わせてゲームのサウンドプロファイルをロードし、
// 状態の更新ごとに「共通イベント + ゲーム固有の onAction / onStateChange」を評価して効果音を鳴らし、
// BGM を切り替える composable。ルールセット・エンジンには一切触れない（フロント側だけの仕組み）。
import { onMounted, onUnmounted, watch, type Ref } from "vue";
import type { BaseGameAction, BaseGameState } from "@engine/shared/GameRules";
import { gameRegistry } from "@engine/shared/GameRegistry";
import { gameUiRegistry } from "@/games/registry";
import { soundDriver } from "@/sound/SoundDriver";
import { commonSounds, deriveCommonCues } from "@/sound/common";
import { useSoundStore } from "@/store/sound";
import {
  normalizeCues,
  type GameSoundProfile,
  type SoundContext,
  type SoundCues,
} from "@/sound/types";

export interface UseGameSoundOptions {
  gameType: string;
  /** 画面が表示している状態。更新のたびに prev → next の差分を評価する */
  state: Ref<BaseGameState | null>;
  /** 直近の state 更新を生んだアクション（state と同時に更新する）。無ければ null */
  lastAction: Ref<BaseGameAction | null>;
  myPlayerId: () => string;
  mode: SoundContext["mode"];
  /**
   * この更新で効果音を鳴らすか。既定は「version が進んだとき」（再同期で同じ版が再送されても鳴らさない）。
   * リプレイはステップが +1 のときだけ鳴らす、といった制御に使う。
   */
  shouldPlay?: (prev: BaseGameState, next: BaseGameState) => boolean;
}

export interface GameSoundHandle {
  /** 画面側から即時に効果音を鳴らす（キーはゲーム → 共通の順に解決） */
  playSE: (key: string, delayMs?: number) => void;
  /** プロファイルのロードが終わったら解決する（テスト・デバッグ用） */
  ready: Promise<void>;
}

const defaultShouldPlay = (prev: BaseGameState, next: BaseGameState) =>
  prev.version === undefined || next.version === undefined || next.version > prev.version;

export function useGameSound(opts: UseGameSoundOptions): GameSoundHandle {
  const store = useSoundStore();
  // ゲーム固有の型はレジストリで消えているので、ここでは共通型で扱う
  let profile: GameSoundProfile | null = null;
  let disposed = false;
  const ruleset = gameRegistry.getDefinition(opts.gameType)?.ruleset;
  let markReady: () => void = () => {};
  const ready = new Promise<void>((resolve) => {
    markReady = resolve;
  });

  const ctx = (): SoundContext => ({ myPlayerId: opts.myPlayerId(), mode: opts.mode });

  const play = (cues: SoundCues) => {
    for (const { key, delayMs } of normalizeCues(cues)) soundDriver.playSE(key, delayMs);
  };

  const syncBgm = (state: BaseGameState) => {
    if (opts.mode !== "live" || !profile?.bgmFor) return;
    const key = profile.bgmFor(state, ctx());
    const def = key ? profile.bgm?.[key] : undefined;
    if (key && def) soundDriver.playBGM(key, def);
    else soundDriver.stopBGM();
  };

  const onUpdate = (next: BaseGameState | null, prev: BaseGameState | null | undefined) => {
    if (!next || disposed) return;
    if (prev && (opts.shouldPlay ?? defaultShouldPlay)(prev, next)) {
      const c = ctx();
      const action = opts.lastAction.value;
      play(deriveCommonCues(prev, next, c, ruleset));
      if (action && profile?.onAction) play(profile.onAction(action, prev, next, c));
      if (profile?.onStateChange) play(profile.onStateChange(prev, next, c));
    }
    syncBgm(next);
  };

  onMounted(async () => {
    store.sync();
    const loader = gameUiRegistry[opts.gameType]?.sound;
    let loaded: GameSoundProfile | null = null;
    if (loader) {
      try {
        loaded = (await loader()).default;
      } catch (err) {
        console.warn(`[Sound] ${opts.gameType} のサウンド定義をロードできません:`, err);
      }
    }
    if (disposed) return; // ロード中に画面が閉じた
    profile = loaded;
    // 共通音を先に登録し、ゲーム側の同名キーで上書きする（ゲーム → 共通の順で解決）
    void soundDriver.preload({ ...commonSounds, ...(profile?.se ?? {}) });
    if (opts.state.value) syncBgm(opts.state.value);
    markReady();
  });

  watch(opts.state, onUpdate);

  onUnmounted(() => {
    disposed = true;
    profile = null;
    soundDriver.unloadAll();
  });

  return {
    playSE: (key, delayMs = 0) => soundDriver.playSE(key, delayMs),
    ready,
  };
}
