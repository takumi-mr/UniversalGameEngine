// packages/input-prediction/__tests__/inputPrediction.test.ts
import { describe, it, expect } from "bun:test";
import {
  HoldLastInputPredictor,
  PredictionStats,
  evaluatePredictor,
  type InputPredictor,
  type RecordedFrame,
} from "@engine/input-prediction";

// 入力は「押しているボタンのビット集合」を想定した数値
const NONE = 0;
const PUNCH = 1;
const KICK = 2;

type State = { frame: number; canAct: boolean };
const st = (frame: number, canAct = true): State => ({ frame, canAct });

describe("HoldLastInputPredictor", () => {
  it("確定入力が無ければ初期値、あれば直前の確定入力を返す", () => {
    const p = new HoldLastInputPredictor<number, State>(NONE);
    expect(p.predict("a", st(0))).toBe(NONE);
    p.observe("a", PUNCH, st(0));
    expect(p.predict("a", st(1))).toBe(PUNCH);
    expect(p.predict("b", st(1))).toBe(NONE); // 別プレイヤーには影響しない
    p.observe("a", NONE, st(1));
    expect(p.predict("a", st(2))).toBe(NONE);
  });

  it("reset で履歴を捨てる（プレイヤー指定 / 全員）", () => {
    const p = new HoldLastInputPredictor<number, State>(NONE);
    p.observe("a", PUNCH, st(0));
    p.observe("b", KICK, st(0));
    p.reset("a");
    expect(p.predict("a", st(1))).toBe(NONE);
    expect(p.predict("b", st(1))).toBe(KICK);
    p.reset();
    expect(p.predict("b", st(2))).toBe(NONE);
  });
});

describe("PredictionStats", () => {
  it("全体正解率・変化点正解率・外れ回数を分けて数える", () => {
    const s = new PredictionStats<number>();
    // 確定列: NONE, NONE, PUNCH, PUNCH, NONE  （変化点は 3 フレーム目と 5 フレーム目）
    s.record("a", NONE, NONE); // 当たり（最初のフレームは変化点に数えない）
    s.record("a", NONE, NONE); // 当たり
    s.record("a", NONE, PUNCH); // 変化点・外れ
    s.record("a", PUNCH, PUNCH); // 当たり
    s.record("a", NONE, NONE); // 変化点・当たり（予測が変化を当てた）
    const r = s.summary();
    expect(r.frames).toBe(5);
    expect(r.hits).toBe(4);
    expect(r.accuracy).toBe(0.8);
    expect(r.transitions).toBe(2);
    expect(r.transitionHits).toBe(1);
    expect(r.transitionAccuracy).toBe(0.5);
    expect(r.mispredictions).toBe(1);
  });

  it("入力が状態に影響しないフレームは外れても正解扱いで、変化点にも数えない", () => {
    const s = new PredictionStats<number>();
    s.record("a", NONE, NONE);
    s.record("a", NONE, PUNCH, false); // 硬直中に押した: 判定外
    s.record("a", PUNCH, KICK, false); // 同上
    const r = s.summary();
    expect(r.frames).toBe(3);
    expect(r.hits).toBe(3);
    expect(r.irrelevantFrames).toBe(2);
    expect(r.transitions).toBe(0);
    expect(r.mispredictions).toBe(0);
  });

  it("プレイヤー別と合計を出せる。等価判定は差し替えられる", () => {
    type Input = { x: number; y: number };
    const s = new PredictionStats<Input>((a, b) => a.x === b.x && a.y === b.y);
    s.record("a", { x: 0, y: 0 }, { x: 0, y: 0 });
    s.record("b", { x: 1, y: 0 }, { x: 0, y: 0 });
    expect(s.summary("a").accuracy).toBe(1);
    expect(s.summary("b").accuracy).toBe(0);
    expect(s.summary().accuracy).toBe(0.5);
    expect(s.players().sort()).toEqual(["a", "b"]);
  });
});

describe("evaluatePredictor", () => {
  const frames: RecordedFrame<number, State>[] = [
    { playerId: "a", input: NONE, state: st(0) },
    { playerId: "a", input: NONE, state: st(1) },
    { playerId: "a", input: PUNCH, state: st(2) }, // 変化点
    { playerId: "a", input: PUNCH, state: st(3) },
    { playerId: "a", input: NONE, state: st(4) }, // 変化点
    { playerId: "a", input: NONE, state: st(5) },
  ];

  it("既定の予測器は変化しないフレームで必ず当たり、変化点で必ず外れる", () => {
    const r = evaluatePredictor(new HoldLastInputPredictor<number, State>(NONE), frames);
    expect(r.frames).toBe(6);
    expect(r.transitions).toBe(2);
    expect(r.transitionHits).toBe(0);
    expect(r.transitionAccuracy).toBe(0);
    expect(r.mispredictions).toBe(2); // 変化点の数だけロールバックが起きる
    expect(r.accuracy).toBeCloseTo(4 / 6);
  });

  it("predict → observe の順で呼ばれる（自分の予測は履歴に入らない）", () => {
    const calls: string[] = [];
    const spy: InputPredictor<number, State> = {
      observe: (_p, input) => calls.push(`observe:${input}`),
      predict: () => {
        calls.push("predict");
        return NONE;
      },
      reset: () => calls.push("reset"),
    };
    evaluatePredictor(spy, frames.slice(0, 2));
    expect(calls).toEqual(["reset", "predict", "observe:0", "predict", "observe:0"]);
  });

  it("状態を条件にする予測器を差し込める（例: 行動不能なら直前入力、行動可能なら変化を先読み）", () => {
    // 「行動可能になった最初のフレームで PUNCH」という癖を知っている予測器
    const oracle: InputPredictor<number, State> = {
      observe() {},
      predict: (_p, state) => (state.canAct && state.frame === 2 ? PUNCH : NONE),
    };
    const withMask = frames.map((f) => ({ ...f, inputMatters: f.state.canAct }));
    const r = evaluatePredictor(oracle, withMask);
    // 変化点は 2 フレーム目（→PUNCH）と 4 フレーム目（→NONE）。どちらも当てている
    expect(r.transitionHits).toBe(2);
    expect(r.transitionAccuracy).toBe(1);
    // 外したのは 3 フレーム目（PUNCH 継続を NONE と予測）だけ
    expect(r.mispredictions).toBe(1);
  });
});
