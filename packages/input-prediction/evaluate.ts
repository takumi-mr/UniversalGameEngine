// packages/input-prediction/evaluate.ts
//
// 確定入力の記録（リプレイ）に対して予測器をオフラインで走らせ、成績を出す。
// ロールバックの実機に組み込む前に、モデルの候補を同じ物差しで比較するための入り口。
//
// 各フレームについて「まず predict → 次に observe」の順で呼ぶ。
// これは実機で「本物の入力が届く前に予測し、届いたら履歴に入れる」のと同じ順序
import type { InputEquality, InputPredictor } from "@engine/input-prediction/InputPredictor";
import { PredictionStats, type PredictionSummary } from "@engine/input-prediction/PredictionStats";

export interface RecordedFrame<TInput, TState> {
  playerId: string;
  input: TInput;
  /** この入力が適用される直前の状態 */
  state: Readonly<TState>;
  /** この入力が状態に影響するか（省略時 true）。硬直中などは false にすると判定から除外される */
  inputMatters?: boolean;
}

export interface EvaluateOptions<TInput> {
  equals?: InputEquality<TInput>;
  /** 評価前に predictor.reset() を呼ぶか（既定 true） */
  resetFirst?: boolean;
}

export function evaluatePredictor<TInput, TState>(
  predictor: InputPredictor<TInput, TState>,
  frames: Iterable<RecordedFrame<TInput, TState>>,
  options: EvaluateOptions<TInput> = {},
): PredictionSummary {
  if (options.resetFirst ?? true) predictor.reset?.();
  const stats = new PredictionStats<TInput>(options.equals);
  for (const frame of frames) {
    const predicted = predictor.predict(frame.playerId, frame.state);
    stats.record(frame.playerId, predicted, frame.input, frame.inputMatters ?? true);
    predictor.observe(frame.playerId, frame.input, frame.state);
  }
  return stats.summary();
}
