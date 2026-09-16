import { describe, it, expect } from "bun:test";
import { CyberStrikeRuleset } from "../CyberStrikeRuleset";
import { withTestRng } from "../../testing/withTestRng";

describe("CyberStrikeRuleset", () => {
  it("getInitialState は正しい初期状態を返す", () => {
    const state = CyberStrikeRuleset.getInitialState();
    expect(state.status).toBe("WAITING");
    expect(state.tick).toBe(0);
    expect(state.arenaWidth).toBe(800);
    expect(state.arenaHeight).toBe(500);
    expect(state.projectiles).toEqual([]);
    expect(state.powerUps).toEqual([]);
  });

  it("START アクションで PLAYING に遷移し、2名のプレイヤーが配置される", () => {
    let state = CyberStrikeRuleset.getInitialState();
    state.players = { "0": "alice", "1": "bob" };

    expect(CyberStrikeRuleset.isValidAction(state, { type: "START", playerId: "alice" })).toBe(
      true,
    );

    state = CyberStrikeRuleset.reduce(state, { type: "START", playerId: "alice" });
    expect(state.status).toBe("PLAYING");
    expect(state.playersData["alice"]).toBeDefined();
    expect(state.playersData["bob"]).toBeDefined();

    const alice = state.playersData["alice"];
    expect(alice.hp).toBe(100);
    expect(alice.energy).toBe(100);
    expect(alice.x).toBe(120);

    const bob = state.playersData["bob"];
    expect(bob.hp).toBe(100);
    expect(bob.x).toBe(800 - 120);
  });

  it("INPUT アクションでプレイヤーの速度と向きが更新される", () => {
    let state = CyberStrikeRuleset.getInitialState();
    state.players = { "0": "alice", "1": "bob" };
    state = CyberStrikeRuleset.reduce(state, { type: "START", playerId: "alice" });

    state = CyberStrikeRuleset.reduce(state, {
      type: "INPUT",
      playerId: "alice",
      seq: 1,
      input: { moveX: 1, moveY: 0 },
    });

    const alice = state.playersData["alice"];
    expect(alice.vx).toBeGreaterThan(0);
    expect(alice.vy).toBe(0);
    expect(alice.lastProcessedSeq).toBe(1);
  });

  it("TICK アクションで移動とアリーナ境界制限が処理される", () => {
    let state = CyberStrikeRuleset.getInitialState();
    state.players = { "0": "alice", "1": "bob" };
    state = CyberStrikeRuleset.reduce(state, { type: "START", playerId: "alice" });

    // 右に移動入力を与える
    state = CyberStrikeRuleset.reduce(state, {
      type: "INPUT",
      playerId: "alice",
      seq: 1,
      input: { moveX: 1, moveY: 0 },
    });

    const initX = state.playersData["alice"].x;
    // TICK を進める
    state = CyberStrikeRuleset.reduce(state, { type: "TICK" });
    expect(state.playersData["alice"].x).toBeGreaterThan(initX);
    expect(state.tick).toBe(1);
  });

  it("ショットで弾が生成され、相手に命中するとHPが減少する", () => {
    let state = CyberStrikeRuleset.getInitialState();
    state.players = { "0": "alice", "1": "bob" };
    state = CyberStrikeRuleset.reduce(state, { type: "START", playerId: "alice" });

    // alice と bob を障害物のない y = 100 に配置
    state = {
      ...state,
      playersData: {
        ...state.playersData,
        alice: {
          ...state.playersData["alice"],
          x: 100,
          y: 100,
        },
        bob: {
          ...state.playersData["bob"],
          x: 200,
          y: 100,
        },
      },
    };

    // alice が右（bobの方向）に向かってショット
    state = CyberStrikeRuleset.reduce(state, {
      type: "INPUT",
      playerId: "alice",
      seq: 1,
      input: { moveX: 0, moveY: 0, fire: true, aimAngle: 0 },
    });

    expect(state.projectiles.length).toBe(1);
    const proj = state.projectiles[0];
    expect(proj.ownerId).toBe("alice");
    expect(proj.vx).toBeGreaterThan(0);

    // 弾が進んで bob に当たるまで TICK を回す
    const initialBobHp = state.playersData["bob"].hp;
    for (let i = 0; i < 20; i++) {
      state = CyberStrikeRuleset.reduce(state, { type: "TICK" });
      if (state.playersData["bob"].hp < initialBobHp) {
        break;
      }
    }

    expect(state.playersData["bob"].hp).toBeLessThan(initialBobHp);
    expect(state.playersData["alice"].score).toBeGreaterThan(0);
  });

  it("checkWinCondition は HP が 0 になったプレイヤーの敗北を検知する", () => {
    let state = CyberStrikeRuleset.getInitialState();
    state.players = { "0": "alice", "1": "bob" };
    state = CyberStrikeRuleset.reduce(state, { type: "START", playerId: "alice" });

    state = {
      ...state,
      playersData: {
        ...state.playersData,
        bob: {
          ...state.playersData["bob"],
          hp: 0,
        },
      },
    };

    const result = CyberStrikeRuleset.checkWinCondition(state);
    expect(result.isFinished).toBe(true);
    expect(result.winnerIds).toContain("alice");
  });

  it("RNG 決定論性: 同じシード値で同じパワーアップ位置が生成される", () => {
    const run = (seed: number) => {
      const wrappedRules = withTestRng(CyberStrikeRuleset, seed);
      let state = wrappedRules.getInitialState();
      state.players = { "0": "alice", "1": "bob" };
      state = wrappedRules.reduce(state, { type: "START", playerId: "alice" });

      // 300 ticks 進めてパワーアップを生成
      for (let i = 0; i < 300; i++) {
        state = wrappedRules.reduce(state, { type: "TICK" });
      }
      return state.powerUps;
    };

    const res1 = run(42);
    const res2 = run(42);
    expect(res1).toEqual(res2);
    expect(res1.length).toBeGreaterThan(0);
  });
});
