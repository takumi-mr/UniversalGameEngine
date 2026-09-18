// packages/input-prediction/HoldLastInputPredictor.ts
//
// 既定の予測器: 「直前の確定入力がそのまま続く」と仮定する（GGPO の標準と同じ）。
// 入力が変化しないフレームでは必ず当たり、変化するフレームでは必ず外れる。
// 学習モデルを評価するときの基準線であり、モデルが確信を持てない場面で退避する先でもある
import type { InputPredictor } from "@engine/input-prediction/InputPredictor";

export class HoldLastInputPredictor<TInput, TState = unknown> implements InputPredictor<
  TInput,
  TState
> {
  private readonly last = new Map<string, TInput>();
  private readonly initialInput: TInput;

  /** @param initialInput まだ確定入力が 1 つも無いプレイヤーに返す値（通常は「何も押していない」） */
  constructor(initialInput: TInput) {
    this.initialInput = initialInput;
  }

  observe(playerId: string, confirmedInput: TInput, _contextState: Readonly<TState>): void {
    this.last.set(playerId, confirmedInput);
  }

  predict(playerId: string, _contextState: Readonly<TState>): TInput {
    return this.last.has(playerId) ? this.last.get(playerId)! : this.initialInput;
  }

  reset(playerId?: string): void {
    if (playerId === undefined) this.last.clear();
    else this.last.delete(playerId);
  }
}
