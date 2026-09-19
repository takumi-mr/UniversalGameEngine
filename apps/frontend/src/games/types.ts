import type { Component } from "vue";
import type { GameSoundProfile } from "@/sound/types";

/** ゲーム選択画面のカテゴリ */
export type GameCategory = "Board Games" | "Card Games" | "Puzzles" | "Special";

/**
 * フロント側のゲーム定義。ルール・人数・説明などのメタ情報は shared の GameRegistry が
 * 持つので、ここには「画面をどう出すか」だけを書く。
 *
 * 新しいゲームを追加するときは `src/games/<type>/index.ts` にこの定義を置くだけでよい
 * （registry.ts が import.meta.glob で自動収集する）。
 */
export interface GameUIDefinition {
  /** GameRegistry に登録されている type と一致させる */
  type: string;
  category: GameCategory;
  /**
   * 対局画面・リプレイ画面で使う盤面コンポーネント（遅延ロード）。
   * 未指定なら Raw State（JSON）表示にフォールバックする。
   */
  component?: () => Promise<{ default: Component }>;
  /**
   * リプレイ画面でも component を使うか。既定は component があれば true。
   * リプレイ（観戦者視点・アクション不可）で崩れるコンポーネントは false にする。
   */
  replay?: boolean;
  /**
   * ゲーム固有の効果音・BGM の定義（遅延ロード）。`src/games/<type>/sound.ts` に
   * `defineSoundProfile({...})` を default export して `() => import("./sound")` を置く。
   * 未指定でも開始・手番・勝敗の共通音は鳴る（`sound/common.ts`）。
   */
  sound?: () => Promise<{ default: GameSoundProfile }>;
}

/** 型推論のためのヘルパー。各 `src/games/<type>/index.ts` の default export に使う */
export function defineGameUI(def: GameUIDefinition): GameUIDefinition {
  return def;
}
