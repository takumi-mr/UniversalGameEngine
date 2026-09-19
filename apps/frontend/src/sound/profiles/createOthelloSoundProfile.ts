// apps/frontend/src/sound/profiles/createOthelloSoundProfile.ts
//
// オセロ（2D / 3D）共通のサウンド定義。どちらの状態も scores（色 → 枚数）と currentTurn を持つので、
// 着手アクションの後に「枚数がどう変わったか」で置く音・裏返す音・パスを決める。
import type { BaseGameAction, BaseGameState } from "@engine/shared/GameRules";
import type { GameSoundProfile, SoundCue } from "@/sound/types";

/** OthelloState / Othello3D の GameState に共通する、音の判定に必要な部分 */
export interface OthelloLikeState extends BaseGameState {
  scores: Record<number, number>;
  currentTurn: number;
}

export interface OthelloSoundOptions {
  /** 着手アクションの type（2D: PLACE_PIECE、3D: MOVE） */
  placeActionType: string;
  /** 音源ディレクトリ（`/sounds/othello` など） */
  baseUrl: string;
  /**
   * 裏返し音を遅らせる時間（ms）。OthelloUI の裏返しアニメーションは 1 フレーム 0.05 進むので
   * 約 20 フレーム ≒ 330ms。中間あたりで鳴らす
   */
  flipDelayMs?: number;
}

const sumScores = (s: OthelloLikeState) => Object.values(s.scores).reduce((a, b) => a + b, 0);

/** 減った枚数（= 裏返された枚数）。増えた色は数えない */
export function countFlipped(prev: OthelloLikeState, next: OthelloLikeState): number {
  let flipped = 0;
  for (const [color, before] of Object.entries(prev.scores)) {
    const after = next.scores[Number(color)] ?? 0;
    if (after < before) flipped += before - after;
  }
  return flipped;
}

export function createOthelloSoundProfile<S extends OthelloLikeState, A extends BaseGameAction>(
  options: OthelloSoundOptions,
): GameSoundProfile<S, A> {
  const { placeActionType, baseUrl, flipDelayMs = 160 } = options;
  return {
    se: {
      place: { src: `${baseUrl}/place.mp3`, cooldownMs: 30 },
      flip: { src: `${baseUrl}/flip.mp3`, maxPolyphony: 2, cooldownMs: 30 },
      pass: { src: `${baseUrl}/pass.mp3` },
    },
    bgm: {
      main: { src: `${baseUrl}/bgm_main.mp3`, loop: true },
    },
    onAction(action, prev, next) {
      if (action.type !== placeActionType) return;
      const cues: SoundCue[] = [];
      if (sumScores(next) > sumScores(prev)) cues.push("place");
      if (countFlipped(prev, next) > 0) cues.push({ key: "flip", delayMs: flipDelayMs });
      // 着手しても手番が戻ってきた = 相手がパス
      if (next.status === "PLAYING" && next.currentTurn === prev.currentTurn) cues.push("pass");
      return cues;
    },
    bgmFor(state) {
      return state.status === "PLAYING" ? "main" : null;
    },
  };
}
