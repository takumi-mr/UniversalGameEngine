import { computed, ref, type ComputedRef, type Ref } from "vue";

/**
 * from → to の 2 クリックで表せるアクション（チェス・将棋の MOVE など）。
 * RESIGN のように from/to を持たないアクションが同じ union に入っていてもよい（無視される）。
 */
export interface MoveLike {
  from?: number;
  to?: number;
}

export interface SelectAndMove<A extends MoveLike> {
  /** 選択中の移動元。未選択なら null */
  selected: Ref<number | null>;
  /**
   * 同じ from/to に複数の合法手がある（チェスの昇格、将棋の成りなど）ときの候補。
   * null でなければ UI は選択ダイアログを出し、choose / cancel で確定する。
   */
  pending: Ref<A[] | null>;
  /** そのマスを移動元として選べるか（= そこから始まる合法手がある） */
  isSelectable: (index: number) => boolean;
  /** 選択中の駒の移動先候補か */
  isTarget: (index: number) => boolean;
  /** マスクリック。選択 / 解除 / 送信 / バリアント選択待ち を状態に応じて行う */
  click: (index: number) => void;
  /** pending の中から 1 つ選んで送信 */
  choose: (action: A) => void;
  /** 選択状態を全て解除 */
  cancel: () => void;
}

/**
 * 「駒を選ぶ → 移動先候補をハイライト → 移動先を選ぶ」の状態機械。
 * 合法手リストだけから判定するので、ゲーム固有のルール（自分の駒か、動ける駒か）を
 * コンポーネントに書かなくてよい。
 */
export function useSelectAndMove<A extends MoveLike>(
  legalActions: ComputedRef<A[]> | Ref<A[]>,
  send: (action: A) => void,
): SelectAndMove<A> {
  const selected = ref<number | null>(null);
  const pending = ref<A[] | null>(null) as Ref<A[] | null>;

  const movesFromSelected = computed(() =>
    selected.value === null ? [] : legalActions.value.filter((a) => a.from === selected.value),
  );

  const isSelectable = (index: number) => legalActions.value.some((a) => a.from === index);
  const isTarget = (index: number) => movesFromSelected.value.some((a) => a.to === index);

  const cancel = () => {
    selected.value = null;
    pending.value = null;
  };

  const click = (index: number) => {
    if (pending.value) return; // バリアント選択中はダイアログ側で確定させる

    if (selected.value === null) {
      if (isSelectable(index)) selected.value = index;
      return;
    }
    if (selected.value === index) {
      selected.value = null;
      return;
    }

    const moves = movesFromSelected.value.filter((a) => a.to === index);
    if (moves.length === 1) {
      send(moves[0]);
      selected.value = null;
      return;
    }
    if (moves.length > 1) {
      pending.value = moves;
      return;
    }
    // 移動先でなければ、別の駒への選択切り替え、または解除
    selected.value = isSelectable(index) ? index : null;
  };

  const choose = (action: A) => {
    send(action);
    cancel();
  };

  return { selected, pending, isSelectable, isTarget, click, choose, cancel };
}
