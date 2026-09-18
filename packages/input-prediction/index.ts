// packages/input-prediction/index.ts
//
// ロールバック方式のネットコード向け入力予測モジュール。
// このパッケージはゲームエンジン（@engine/shared）にもバックエンドにも依存しない。
export {
  type InputPredictor,
  type InputEquality,
  defaultInputEquality,
} from "@engine/input-prediction/InputPredictor";
export { HoldLastInputPredictor } from "@engine/input-prediction/HoldLastInputPredictor";
export { PredictionStats, type PredictionSummary } from "@engine/input-prediction/PredictionStats";
export {
  evaluatePredictor,
  type RecordedFrame,
  type EvaluateOptions,
} from "@engine/input-prediction/evaluate";
