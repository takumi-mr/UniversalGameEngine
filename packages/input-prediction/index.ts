// packages/input-prediction/index.ts
//
// ロールバック方式のネットコード向け入力予測モジュール。
// このパッケージはゲームエンジン（@engine/shared）にもバックエンドにも依存しない。
export { type InputPredictor, type InputEquality, defaultInputEquality } from "./InputPredictor";
export { HoldLastInputPredictor } from "./HoldLastInputPredictor";
export { PredictionStats, type PredictionSummary } from "./PredictionStats";
export { evaluatePredictor, type RecordedFrame, type EvaluateOptions } from "./evaluate";
