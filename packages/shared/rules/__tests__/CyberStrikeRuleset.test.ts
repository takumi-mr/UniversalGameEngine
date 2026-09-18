// packages/shared/rules/__tests__/CyberStrikeRuleset.test.ts
import { describe, it, expect } from "bun:test";
import {
  CyberStrikeRuleset,
  BOT_ID,
  TICK_RATE,
  tickAt,
  type CyberStrikeState,
} from "@engine/shared/rules/CyberStrikeRuleset";
import { withTestRng } from "@engine/shared/testing/withTestRng";
import { UniversalEngine } from "@engine/shared/UniversalEngine";

const T0 = 1_000_000;
const MS_PER_TICK = 1000 / TICK_RATE;

function started(players: string[] = ["alice", "bob"], timestamp?: number): CyberStrikeState {
  let state = CyberStrikeRuleset.getInitialState();
  state.players = { "0": players[0] ?? null, "1": players[1] ?? null };
  state = CyberStrikeRuleset.reduce(state, { type: "START", playerId: players[0], timestamp });
  return state;
}

describe("CyberStrikeRuleset: 開始とプレイヤー配置", () => {
  it("getInitialState は待機状態", () => {
    const state = CyberStrikeRuleset.getInitialState();
    expect(state.status).toBe("WAITING");
    expect(state.tick).toBe(0);
    expect(state.tickRate).toBe(TICK_RATE);
    expect(state.projectiles).toEqual([]);
    expect(state.botId).toBeNull();
  });

  it("2 人着席で START すると両者が配置され、ボットは出ない", () => {
    const state = started();
    expect(state.status).toBe("PLAYING");
    expect(state.playersData.alice.x).toBe(120);
    expect(state.playersData.bob.x).toBe(800 - 120);
    expect(state.botId).toBeNull();
    expect(state.activePlayers).toEqual(["alice", "bob"]);
  });

  it("1 人で START するとシミュレーション内の CPU ボットが相手になり、席は空いたまま", () => {
    const state = started(["alice"]);
    expect(state.botId).toBe(BOT_ID);
    expect(state.playersData[BOT_ID]).toBeDefined();
    expect(state.players).toEqual({ "0": "alice", "1": null });
    expect(state.activePlayers).toEqual(["alice"]);
  });

  it("進行中に 2 人目が着席するとボットと入れ替わる（エンジンの組み込み JOIN 経由）", () => {
    const engine = new UniversalEngine(CyberStrikeRuleset, {});
    engine.dispatch({ type: "JOIN", playerId: "alice" });
    engine.dispatch({ type: "START", playerId: "alice", timestamp: T0 });
    for (let i = 0; i < 10; i++) engine.dispatch({ type: "TICK" });
    const botPos = engine.getState().playersData[BOT_ID];

    expect(engine.dispatch({ type: "JOIN", playerId: "bob" })).toBe(true);
    const s = engine.getState();
    expect(s.players).toEqual({ "0": "alice", "1": "bob" });
    expect(s.botId).toBeNull();
    expect(s.playersData[BOT_ID]).toBeUndefined();
    expect(s.playersData.bob.x).toBe(botPos.x);
    expect(s.playersData.bob.hp).toBe(100);
    expect(s.activePlayers).toEqual(["alice", "bob"]);
    expect(s.tick).toBe(10);
  });

  it("RESET は着席者が終局後（または進行中）に新しい試合を始める", () => {
    let state = started();
    state.playersData.alice.hp = 0;
    state.status = "FINISHED";
    expect(CyberStrikeRuleset.isValidAction(state, { type: "RESET", playerId: "zed" })).toBe(false);
    expect(CyberStrikeRuleset.isValidAction(state, { type: "RESET", playerId: "bob" })).toBe(true);
    state = CyberStrikeRuleset.reduce(state, { type: "RESET", playerId: "bob", timestamp: T0 });
    expect(state.status).toBe("PLAYING");
    expect(state.playersData.alice.hp).toBe(100);
    expect(state.tick).toBe(0);
    expect(state.startedAt).toBe(T0);
  });
});

describe("CyberStrikeRuleset: 入力と物理", () => {
  it("INPUT で速度と向きが更新され、lastProcessedSeq が記録される", () => {
    let state = started();
    state = CyberStrikeRuleset.reduce(state, {
      type: "INPUT",
      playerId: "alice",
      seq: 1,
      input: { moveX: 1, moveY: 0 },
    });
    const alice = state.playersData.alice;
    expect(alice.vx).toBeGreaterThan(0);
    expect(alice.vy).toBe(0);
    expect(alice.lastProcessedSeq).toBe(1);
    // 着席していない・存在しないプレイヤーの INPUT は不正
    expect(
      CyberStrikeRuleset.isValidAction(state, {
        type: "INPUT",
        playerId: "zed",
        input: { moveX: 0, moveY: 0 },
      }),
    ).toBe(false);
  });

  it("timestamp の無い TICK は 1 ティック進み、境界で止まる", () => {
    let state = started();
    state = CyberStrikeRuleset.reduce(state, {
      type: "INPUT",
      playerId: "alice",
      input: { moveX: -1, moveY: 0 },
    });
    for (let i = 0; i < 100; i++) state = CyberStrikeRuleset.reduce(state, { type: "TICK" });
    expect(state.tick).toBe(100);
    expect(state.playersData.alice.x).toBe(state.playersData.alice.radius);
  });

  it("障害物にぶつかっても速度は消えず、軸ごとに判定するので沿って滑れる", () => {
    let state = started();
    // 障害物 {x:180..220, y:220..280} の左に置き、右下へ押し続ける
    state.playersData.alice = { ...state.playersData.alice, x: 150, y: 250 };
    state = CyberStrikeRuleset.reduce(state, {
      type: "INPUT",
      playerId: "alice",
      input: { moveX: 1, moveY: 1 },
    });
    let touchedWall = false;
    for (let i = 0; i < 30; i++) {
      state = CyberStrikeRuleset.reduce(state, { type: "TICK" });
      const a = state.playersData.alice;
      // 障害物には入らない（円と矩形が重ならない）
      const cx = Math.max(180, Math.min(a.x, 220));
      const cy = Math.max(220, Math.min(a.y, 280));
      expect((a.x - cx) ** 2 + (a.y - cy) ** 2).toBeGreaterThanOrEqual(a.radius ** 2);
      if (a.x + a.radius >= 180 && a.y < 280 + a.radius) touchedWall = true;
    }
    const a = state.playersData.alice;
    expect(touchedWall).toBe(true); // 一度は壁に当たり
    expect(a.vx).toBeGreaterThan(0); // 速度は保持され
    expect(a.y).toBeGreaterThan(280 + a.radius); // 縦に滑って障害物の下を抜け
    expect(a.x).toBeGreaterThan(180); // その後は右へ進んでいる
  });

  it("入力を止めなければ動き続け、移動 0 の INPUT で止まる", () => {
    let state = started();
    state = CyberStrikeRuleset.reduce(state, {
      type: "INPUT",
      playerId: "alice",
      input: { moveX: 1, moveY: 0 },
    });
    state = CyberStrikeRuleset.reduce(state, { type: "TICK" });
    state = CyberStrikeRuleset.reduce(state, { type: "TICK" });
    const moved = state.playersData.alice.x;
    expect(moved).toBeGreaterThan(120);
    state = CyberStrikeRuleset.reduce(state, {
      type: "INPUT",
      playerId: "alice",
      input: { moveX: 0, moveY: 0 },
    });
    state = CyberStrikeRuleset.reduce(state, { type: "TICK" });
    expect(state.playersData.alice.x).toBe(moved);
  });

  it("ショットで弾が生成され、命中すると HP が減りスコアが入る", () => {
    let state = started();
    // bob を alice の正面 60px に置く
    state.playersData.bob = { ...state.playersData.bob, x: 180, y: 250 };
    state = CyberStrikeRuleset.reduce(state, {
      type: "INPUT",
      playerId: "alice",
      input: { moveX: 0, moveY: 0, fire: true, aimAngle: 0 },
    });
    expect(state.projectiles.length).toBe(1);
    expect(state.playersData.alice.energy).toBe(80);
    for (let i = 0; i < 10; i++) state = CyberStrikeRuleset.reduce(state, { type: "TICK" });
    expect(state.projectiles.length).toBe(0);
    expect(state.playersData.bob.hp).toBe(100 - 18);
    expect(state.playersData.alice.score).toBe(10);
  });

  it("checkWinCondition は HP 0 と時間切れを判定する", () => {
    const state = started();
    const dead = { ...state, playersData: { ...state.playersData } };
    dead.playersData.bob = { ...dead.playersData.bob, hp: 0 };
    expect(CyberStrikeRuleset.checkWinCondition(dead).winnerIds).toEqual(["alice"]);

    const timeUp = { ...state, tick: state.maxTicks };
    timeUp.playersData = { ...timeUp.playersData, alice: { ...timeUp.playersData.alice, hp: 50 } };
    expect(CyberStrikeRuleset.checkWinCondition(timeUp).winnerIds).toEqual(["bob"]);
    expect(CyberStrikeRuleset.checkWinCondition(state).isFinished).toBe(false);
  });
});

describe("CyberStrikeRuleset: 時刻駆動", () => {
  it("timestamp 付きのアクションは開始時刻からの経過に応じてティックを追いつかせる", () => {
    let state = started(["alice", "bob"], T0);
    expect(state.startedAt).toBe(T0);
    expect(tickAt(state, T0 + 1000)).toBe(TICK_RATE);

    // 1 秒後の INPUT: 30 ティック進んでから入力が反映される
    state = CyberStrikeRuleset.reduce(state, {
      type: "INPUT",
      playerId: "alice",
      timestamp: T0 + 1000,
      input: { moveX: 1, moveY: 0 },
    });
    expect(state.tick).toBe(TICK_RATE);
    expect(state.playersData.alice.x).toBe(120); // 入力前のティックでは動いていない
    expect(state.playersData.alice.vx).toBeGreaterThan(0);

    // ハートビート（TICK + timestamp）でも進む。過去の時刻には戻らない
    state = CyberStrikeRuleset.reduce(state, { type: "TICK", timestamp: T0 + 1500 });
    expect(state.tick).toBe(45);
    expect(state.playersData.alice.x).toBeGreaterThan(120);
    const before = state;
    state = CyberStrikeRuleset.reduce(state, { type: "TICK", timestamp: T0 + 1200 });
    expect(state).toBe(before);
  });

  it("tick 指定の TICK はそのティックまで進める（予測時点への進め直し用）", () => {
    let state = started(["alice", "bob"], T0);
    state = CyberStrikeRuleset.reduce(state, { type: "TICK", tick: 17 });
    expect(state.tick).toBe(17);
    state = CyberStrikeRuleset.reduce(state, { type: "TICK", tick: 5 });
    expect(state.tick).toBe(17);
  });

  it("長く放置されていたら上限まで追いつき、開始時刻をずらして以後は正常に進む", () => {
    let state = started(["alice", "bob"], T0);
    const later = T0 + 60_000; // 60 秒後（1800 ティック分）
    state = CyberStrikeRuleset.reduce(state, { type: "TICK", timestamp: later });
    expect(state.tick).toBe(TICK_RATE * 3);
    // ずらした開始時刻から見て、いまの時刻がちょうど現在のティックになっている
    expect(tickAt(state, later)).toBe(state.tick);
    state = CyberStrikeRuleset.reduce(state, { type: "TICK", timestamp: later + MS_PER_TICK * 2 });
    expect(state.tick).toBe(TICK_RATE * 3 + 2);
  });

  it("同じ timestamp 列なら同じ結果になる（クライアント予測とサーバーが一致する前提）", () => {
    const run = () => {
      const rules = withTestRng(CyberStrikeRuleset, 7);
      let s = rules.getInitialState();
      s.players = { "0": "alice", "1": null };
      s = rules.reduce(s, { type: "START", playerId: "alice", timestamp: T0 });
      const inputs = [
        { t: 100, moveX: 1, moveY: 0 },
        { t: 700, moveX: 0, moveY: 1, fire: true },
        { t: 1300, moveX: -1, moveY: 0, dash: true },
        { t: 2500, moveX: 0, moveY: 0 },
      ];
      for (const i of inputs) {
        s = rules.reduce(s, {
          type: "INPUT",
          playerId: "alice",
          timestamp: T0 + i.t,
          input: { moveX: i.moveX, moveY: i.moveY, fire: i.fire, dash: i.dash, aimAngle: 0 },
        });
      }
      // 2 秒ごとのハートビートで 12 秒まで進める（1 回の追いつき上限 3 秒以内）
      for (let t = 4000; t <= 12_000; t += 2000) {
        s = rules.reduce(s, { type: "TICK", timestamp: T0 + t });
      }
      return s;
    };
    const a = run();
    const b = run();
    expect(a).toEqual(b);
    expect(a.tick).toBe(360);
    // ボットも動いている
    expect(a.playersData[BOT_ID].x).not.toBe(800 - 120);
    expect(a.powerUps.length).toBeGreaterThan(0);
  });

  it("決着したらそのティックで止まる", () => {
    let state = started(["alice", "bob"], T0);
    state.playersData.bob = { ...state.playersData.bob, x: 180, y: 250, hp: 18 };
    state = CyberStrikeRuleset.reduce(state, {
      type: "INPUT",
      playerId: "alice",
      timestamp: T0,
      input: { moveX: 0, moveY: 0, fire: true, aimAngle: 0 },
    });
    state = CyberStrikeRuleset.reduce(state, { type: "TICK", timestamp: T0 + 5000 });
    expect(state.playersData.bob.hp).toBe(0);
    expect(state.tick).toBeLessThan(20);
    expect(CyberStrikeRuleset.checkWinCondition(state).winnerIds).toEqual(["alice"]);
  });
});
