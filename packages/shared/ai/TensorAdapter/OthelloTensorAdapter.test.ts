// packages/shared/ai/TensorAdapter/OthelloTensorAdapter.test.ts
import { describe, it, expect } from "bun:test";
import { OthelloRuleset } from "../../rules/OthelloRuleset";
import type { OthelloState, OthelloAction } from "../../rules/OthelloRuleset";
import { OthelloTensorAdapter } from "./OthelloTensorAdapter";
import { aiTensorRegistry } from "../AITensorAdapterRegistry";
import "./index";

function playingState() {
  const state = OthelloRuleset.getInitialState();
  state.status = "PLAYING";
  state.players = { 1: "black", [-1]: "white" };
  state.activePlayers = ["black"];
  return state;
}

describe("OthelloTensorAdapter", () => {
  it("レジストリに 'othello' として登録されていること", () => {
    const get = (t: string) => aiTensorRegistry.getAdapter<OthelloState, OthelloAction>(t);
    expect(get("othello")).toBe(OthelloTensorAdapter);
    expect(get("OTHELLO")).toBe(OthelloTensorAdapter);
  });

  it("encodeState は size*size 個の数値を自分視点（自分=+1, 相手=-1）で返すこと", () => {
    const state = playingState();
    const black = OthelloTensorAdapter.encodeState(state, "black");
    const white = OthelloTensorAdapter.encodeState(state, "white");

    expect(black.length).toBe(64);
    // (x=4, y=3) は黒 → 黒視点では +1、白視点では -1
    expect(black[3 * 8 + 4]).toBe(1);
    expect(white[3 * 8 + 4]).toBe(-1);
    // (x=3, y=3) は白
    expect(black[3 * 8 + 3]).toBe(-1);
    expect(white[3 * 8 + 3]).toBe(1);
    // 空マス
    expect(black[0]).toBe(0);
    // 白視点は黒視点の符号反転
    expect(white).toEqual(black.map((v) => -v || 0));
  });

  it("encodeLegalActions は初期局面の黒の合法手 4 つを y*size+x で返すこと", () => {
    const state = playingState();
    const ids = OthelloTensorAdapter.encodeLegalActions(state, "black").sort((a, b) => a - b);
    // (3,2)=19, (2,3)=26, (5,4)=37, (4,5)=44
    expect(ids).toEqual([19, 26, 37, 44]);
    // 手番でないプレイヤーには合法手なし
    expect(OthelloTensorAdapter.encodeLegalActions(state, "white")).toEqual([]);
  });

  it("decodeAction は actionId を PLACE_PIECE に復元し、ルールセットで合法と判定されること", () => {
    const state = playingState();
    const action = OthelloTensorAdapter.decodeAction(state, 19, "black");
    expect(action).toEqual({ type: "PLACE_PIECE", x: 3, y: 2, color: 1, playerId: "black" });
    expect(OthelloRuleset.isValidAction(state, action)).toBe(true);
  });

  it("encode → decode がラウンドトリップすること", () => {
    const state = playingState();
    for (const id of OthelloTensorAdapter.encodeLegalActions(state, "black")) {
      const a = OthelloTensorAdapter.decodeAction(state, id, "black");
      expect(a.y * state.size + a.x).toBe(id);
    }
  });

  it("範囲外の actionId は例外を投げること", () => {
    const state = playingState();
    expect(() => OthelloTensorAdapter.decodeAction(state, 64, "black")).toThrow();
    expect(() => OthelloTensorAdapter.decodeAction(state, -1, "black")).toThrow();
  });
});
