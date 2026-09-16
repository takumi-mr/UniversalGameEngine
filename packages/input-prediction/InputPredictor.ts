// packages/input-prediction/InputPredictor.ts
//
// ロールバック方式のネットコードで「まだ届いていない相手の入力」を仮に埋めるための予測器の契約。
//
// 位置づけ:
//   - 予測は各ピアがローカルで独立に行う。ピア間で同じ実装・同じ結果である必要はない
//   - 予測値は仮の描画にしか使われず、本物の入力が届けば捨てられる。
//     したがって予測器は決定論的である必要も、純粋である必要もない（ここだけが決定論の縛りの外）
//   - 予測器が触ってよいのは「確定した入力の履歴」と「現在の状態（読み取り専用）」だけ。
//     状態を書き換えてはならない
//
// TInput: 1 フレーム分の入力（ボタンの押下状態など）。等価比較の方法は利用側が決める
// TState: 予測の条件付けに使う状態。予測器は中身を仮定せず、必要なら実装側で絞る

export interface InputPredictor<TInput, TState = unknown> {
  /**
   * 確定入力が届くたびに履歴として与える。フレーム順に呼ばれることを前提にしてよい。
   * contextState はその入力が適用される直前の状態
   */
  observe(playerId: string, confirmedInput: TInput, contextState: Readonly<TState>): void;

  /**
   * 確定入力がまだ無いフレームで呼ばれる。返り値は「仮」なので、何を返しても正しさは壊れない。
   * 連続する複数フレームを予測する場合も、フレームごとに呼ばれる（自分の予測値は履歴に入らない）
   */
  predict(playerId: string, contextState: Readonly<TState>): TInput;

  /** 対局の開始などで履歴を捨てる（任意） */
  reset?(playerId?: string): void;
}

/** 入力の等価判定。既定は Object.is（プリミティブやインターン済みの入力向け） */
export type InputEquality<TInput> = (a: TInput, b: TInput) => boolean;

export const defaultInputEquality = <TInput>(a: TInput, b: TInput): boolean => Object.is(a, b);
