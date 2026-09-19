import { describe, it, expect, vi } from "vitest";
import { ref } from "vue";
import { useSelectAndMove } from "@/composables/useSelectAndMove";

interface Move {
  type: "MOVE" | "RESIGN";
  from?: number;
  to?: number;
  promotion?: number;
}

const setup = (legal: Move[]) => {
  const legalActions = ref<Move[]>(legal);
  const send = vi.fn<(a: Move) => void>();
  const sm = useSelectAndMove(legalActions, send);
  return { legalActions, send, sm };
};

describe("useSelectAndMove", () => {
  it("合法手の from だけが選択でき、選択後は to がハイライトされる", () => {
    const { sm } = setup([
      { type: "MOVE", from: 8, to: 16 },
      { type: "MOVE", from: 8, to: 24 },
      { type: "RESIGN" },
    ]);
    expect(sm.isSelectable(8)).toBe(true);
    expect(sm.isSelectable(9)).toBe(false);
    expect(sm.isTarget(16)).toBe(false);

    sm.click(9);
    expect(sm.selected.value).toBeNull();
    sm.click(8);
    expect(sm.selected.value).toBe(8);
    expect(sm.isTarget(16)).toBe(true);
    expect(sm.isTarget(17)).toBe(false);
  });

  it("移動先をクリックすると送信して選択解除", () => {
    const { sm, send } = setup([{ type: "MOVE", from: 8, to: 16 }]);
    sm.click(8);
    sm.click(16);
    expect(send).toHaveBeenCalledWith({ type: "MOVE", from: 8, to: 16 });
    expect(sm.selected.value).toBeNull();
  });

  it("同じマスの再クリックで解除、別の自駒クリックで切り替え、無関係なマスで解除", () => {
    const { sm, send } = setup([
      { type: "MOVE", from: 8, to: 16 },
      { type: "MOVE", from: 9, to: 17 },
    ]);
    sm.click(8);
    sm.click(8);
    expect(sm.selected.value).toBeNull();

    sm.click(8);
    sm.click(9);
    expect(sm.selected.value).toBe(9);

    sm.click(40);
    expect(sm.selected.value).toBeNull();
    expect(send).not.toHaveBeenCalled();
  });

  it("同じ from/to に複数の合法手（昇格）があれば pending にして選択を待つ", () => {
    const promos: Move[] = [5, 4, 3, 2].map((p) => ({
      type: "MOVE",
      from: 48,
      to: 56,
      promotion: p,
    }));
    const { sm, send } = setup(promos);
    sm.click(48);
    sm.click(56);
    expect(send).not.toHaveBeenCalled();
    expect(sm.pending.value).toEqual(promos);

    // 選択待ち中は盤面クリックを無視する
    sm.click(48);
    expect(sm.pending.value).toEqual(promos);

    sm.choose(promos[1]);
    expect(send).toHaveBeenCalledWith(promos[1]);
    expect(sm.pending.value).toBeNull();
    expect(sm.selected.value).toBeNull();
  });

  it("cancel で pending と選択を破棄する", () => {
    const { sm, send } = setup([
      { type: "MOVE", from: 48, to: 56, promotion: 5 },
      { type: "MOVE", from: 48, to: 56, promotion: 4 },
    ]);
    sm.click(48);
    sm.click(56);
    sm.cancel();
    expect(sm.pending.value).toBeNull();
    expect(sm.selected.value).toBeNull();
    expect(send).not.toHaveBeenCalled();
  });

  it("合法手が入れ替わると（手番が移ると）選択状態の判定も追従する", () => {
    const { sm, legalActions } = setup([{ type: "MOVE", from: 8, to: 16 }]);
    sm.click(8);
    legalActions.value = [];
    expect(sm.isTarget(16)).toBe(false);
  });
});
