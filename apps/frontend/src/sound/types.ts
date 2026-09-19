import type { BaseGameAction, BaseGameState } from "@engine/shared/GameRules";

/** 効果音 1 つの定義 */
export interface SoundAssetDef {
  /** 音源 URL（`public/sounds/...` に置いたファイルなら `/sounds/<game>/<name>.mp3`） */
  src: string;
  /** 同時に鳴らせる最大数。超えた分は捨てる（既定 4） */
  maxPolyphony?: number;
  /** 前回の再生からこの時間（ms）以内なら鳴らさない（連打・連続更新の抑制） */
  cooldownMs?: number;
  /** この音だけの音量係数 0..1（既定 1） */
  volume?: number;
}

/** BGM 1 つの定義 */
export interface BgmDef {
  src: string;
  /** 既定 true */
  loop?: boolean;
  /** この曲だけの音量係数 0..1（既定 1） */
  volume?: number;
}

/**
 * 鳴らす効果音の指定。キーだけ、または遅延付き（盤面アニメーションに合わせるとき）。
 * キーは「ゲームの se → 共通の se」の順に解決される（`sound/common.ts`）。
 */
export type SoundCue = string | { key: string; delayMs?: number };
export type SoundCues = SoundCue | SoundCue[] | void;

export interface SoundContext {
  /** 自分の ID。観戦者・リプレイでは "SPECTATOR" */
  myPlayerId: string;
  /** live: 対局画面、replay: リプレイ画面（BGM は流さない） */
  mode: "live" | "replay";
}

/**
 * ゲームごとのサウンド定義。`src/games/<type>/sound.ts` の default export にして
 * `defineGameUI({ sound: () => import("./sound") })` で登録する（フロント側だけの仕組みで、
 * ルールセット・エンジンは関与しない）。
 *
 * 開始 / 自分の手番 / 勝敗の音は `sound/common.ts` が全ゲーム共通で導出するので、
 * ここにはゲーム固有の音だけを書けばよい。共通と同じキー（例 `victory`）を `se` に定義すれば
 * そのゲームだけ差し替えられる。
 */
export interface GameSoundProfile<
  S extends BaseGameState = BaseGameState,
  A extends BaseGameAction = BaseGameAction,
> {
  se: Record<string, SoundAssetDef>;
  bgm?: Record<string, BgmDef>;
  /**
   * サーバーが適用したアクション（自分・相手・AI すべて）と、その前後の状態から鳴らす音を決める。
   * 対局中はサーバーが状態配信に同梱したアクション、リプレイでは記録のアクションが渡る。
   */
  onAction?(action: A, prev: S, next: S, ctx: SoundContext): SoundCues;
  /**
   * アクションを伴わない更新（JOIN / START / 離席・再同期）も含め、状態が進むたびに呼ばれる。
   * アクションからは分からない結果（流局など）を状態差分で拾うときに使う。
   */
  onStateChange?(prev: S, next: S, ctx: SoundContext): SoundCues;
  /**
   * 今の状態で流す BGM のキー（`bgm` のキー）。null で停止。戻り値が変わったときだけ切り替える。
   * リプレイでは呼ばれない。
   */
  bgmFor?(state: S, ctx: SoundContext): string | null;
}

/** 型推論のためのヘルパー。各 `src/games/<type>/sound.ts` の default export に使う */
export function defineSoundProfile<S extends BaseGameState, A extends BaseGameAction>(
  profile: GameSoundProfile<S, A>,
): GameSoundProfile<S, A> {
  return profile;
}

/** SoundCues を { key, delayMs } の配列に正規化する */
export function normalizeCues(cues: SoundCues): { key: string; delayMs: number }[] {
  if (!cues) return [];
  const list = Array.isArray(cues) ? cues : [cues];
  return list.map((c) =>
    typeof c === "string" ? { key: c, delayMs: 0 } : { key: c.key, delayMs: c.delayMs ?? 0 },
  );
}
