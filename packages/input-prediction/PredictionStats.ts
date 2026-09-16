// packages/input-prediction/PredictionStats.ts
//
// 予測器の良し悪しを測る物差し。
// 「生のフレーム正解率」は入力が変化しないフレームで水増しされるので、次の 3 つを分けて数える。
//   - accuracy:           全フレームの正解率（参考値。既定の予測器でも 9 割を超える）
//   - transitionAccuracy: 入力が変化したフレームだけの正解率（既定の予測器は定義上 0）。ここが本命
//   - mispredictions:     予測が外れたフレーム数 ＝ ロールバックが起きる回数
// 「そのフレームの入力が状態に影響しない」（硬直中など）と分かっている場合は inputMatters=false で渡す。
// そのフレームは外れてもロールバック不要なので、正解として数える
import { defaultInputEquality, type InputEquality } from "./InputPredictor";

export interface PredictionSummary {
  frames: number;
  hits: number;
  accuracy: number;
  transitions: number;
  transitionHits: number;
  transitionAccuracy: number;
  mispredictions: number;
  /** 入力が状態に影響しないため、判定から除外したフレーム数 */
  irrelevantFrames: number;
}

interface Counter {
  frames: number;
  hits: number;
  transitions: number;
  transitionHits: number;
  irrelevantFrames: number;
  lastConfirmed?: unknown;
  hasLast: boolean;
}

const emptyCounter = (): Counter => ({
  frames: 0,
  hits: 0,
  transitions: 0,
  transitionHits: 0,
  irrelevantFrames: 0,
  hasLast: false,
});

export class PredictionStats<TInput> {
  private readonly perPlayer = new Map<string, Counter>();
  private readonly equals: InputEquality<TInput>;

  constructor(equals: InputEquality<TInput> = defaultInputEquality) {
    this.equals = equals;
  }

  /**
   * 1 フレーム分の答え合わせ。
   * @param predicted   そのフレームに対して出していた予測
   * @param confirmed   後から届いた本物の入力
   * @param inputMatters そのフレームの入力が状態に影響するか（false なら外れてもロールバック不要）
   */
  record(playerId: string, predicted: TInput, confirmed: TInput, inputMatters = true): void {
    const c = this.perPlayer.get(playerId) ?? emptyCounter();
    this.perPlayer.set(playerId, c);

    const isTransition = c.hasLast && !this.equals(c.lastConfirmed as TInput, confirmed);
    const hit = !inputMatters || this.equals(predicted, confirmed);

    c.frames++;
    if (hit) c.hits++;
    if (!inputMatters) c.irrelevantFrames++;
    if (isTransition && inputMatters) {
      c.transitions++;
      if (hit) c.transitionHits++;
    }
    c.lastConfirmed = confirmed;
    c.hasLast = true;
  }

  summary(playerId?: string): PredictionSummary {
    const counters =
      playerId === undefined
        ? [...this.perPlayer.values()]
        : [this.perPlayer.get(playerId) ?? emptyCounter()];
    const total = counters.reduce(
      (acc, c) => ({
        frames: acc.frames + c.frames,
        hits: acc.hits + c.hits,
        transitions: acc.transitions + c.transitions,
        transitionHits: acc.transitionHits + c.transitionHits,
        irrelevantFrames: acc.irrelevantFrames + c.irrelevantFrames,
      }),
      { frames: 0, hits: 0, transitions: 0, transitionHits: 0, irrelevantFrames: 0 },
    );
    return {
      ...total,
      accuracy: total.frames === 0 ? 0 : total.hits / total.frames,
      transitionAccuracy: total.transitions === 0 ? 0 : total.transitionHits / total.transitions,
      mispredictions: total.frames - total.hits,
    };
  }

  players(): string[] {
    return [...this.perPlayer.keys()];
  }

  reset(): void {
    this.perPlayer.clear();
  }
}
