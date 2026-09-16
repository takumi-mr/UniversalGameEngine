# @engine/input-prediction

ロールバック方式のネットコードで「まだ届いていない相手の入力」を仮に埋めるための、入力予測のインターフェースと評価用の道具。

**ゲームエンジン（`@engine/shared`）にもバックエンドにも依存しない。** 予測は各ピアがローカルで独立に行い、結果は仮の描画にしか使われないため、ピア間で同じ実装である必要も、決定論的である必要もない。このパッケージが「決定論の縛りの外」に置かれているのはそのため。

## 契約

```ts
interface InputPredictor<TInput, TState = unknown> {
  // 確定入力が届くたびに履歴として与える（フレーム順）
  observe(playerId: string, confirmedInput: TInput, contextState: Readonly<TState>): void;
  // 確定入力がまだ無いフレームで呼ばれる。返り値は仮なので何を返しても正しさは壊れない
  predict(playerId: string, contextState: Readonly<TState>): TInput;
  reset?(playerId?: string): void;
}
```

予測器が触ってよいのは「確定した入力の履歴」と「現在の状態（読み取り専用）」だけ。状態を書き換えてはならない。

## 入っているもの

| ファイル                    | 役割                                                                                              |
| --------------------------- | ------------------------------------------------------------------------------------------------- |
| `InputPredictor.ts`         | 契約と入力の等価判定の型                                                                          |
| `HoldLastInputPredictor.ts` | 既定の予測器。「直前の確定入力が続く」と仮定する（GGPO の標準）。学習モデルの基準線であり、退避先 |
| `PredictionStats.ts`        | 物差し。全体正解率・**変化点正解率**・外れ回数（＝ロールバック回数）を分けて数える                |
| `evaluate.ts`               | 確定入力の記録に対して予測器をオフラインで走らせる                                                |

実際の学習モデルは含まない。

## 物差しについて

生のフレーム正解率は「入力が変化しないフレーム」で水増しされ、既定の予測器でも 9 割を超える。見るべきは **入力が変化したフレームでの正解率（`transitionAccuracy`）** と **外れた回数（`mispredictions`）**。既定の予測器は前者が定義上 0 で、モデルの価値はここをどれだけ上げられるかで決まる。

「そのフレームの入力は状態に影響しない」（硬直中など）と分かっている場合は `inputMatters=false` で渡す。外れてもロールバック不要なので、判定から除外される。これはゲームのルール側が教えられる情報で、学習の前にやるべき最大の改善。

## 使い方（オフライン評価）

```ts
import { evaluatePredictor, HoldLastInputPredictor } from "@engine/input-prediction";

const baseline = evaluatePredictor(new HoldLastInputPredictor(NONE), frames);
const candidate = evaluatePredictor(myPredictor, frames);
// candidate.transitionAccuracy と candidate.mispredictions を baseline と比べる
```

`frames` は `{ playerId, input, state, inputMatters? }` の列。リプレイ（`GameRecord` の `actions`）から作れる。

## 実機（ロールバックループ）への組み込み

1. 本物の入力が届いたフレーム: `observe`
2. 届いていないフレーム: `predict` の値でシミュレートし、届いたら本物で巻き戻す
3. 答え合わせを `PredictionStats.record` に流せば、稼働中の成績が取れる
