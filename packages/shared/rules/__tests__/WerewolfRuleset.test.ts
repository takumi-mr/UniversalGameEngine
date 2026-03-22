import { expect, test, describe } from "bun:test";
import { WerewolfRuleset, getTeam } from "../WerewolfRuleset";
import type { WerewolfState } from "../WerewolfRuleset";

// テスト用ヘルパー: 特定の役職配分で状態を作成
function createTestState(roleAssignment: Record<string, string>): WerewolfState {
  const playerIds = Object.keys(roleAssignment);
  const state = WerewolfRuleset.getInitialState({ playerIds });
  state.status = "PLAYING";

  // 役職を上書き
  for (const [pId, role] of Object.entries(roleAssignment)) {
    state.roles[pId] = {
      __isSecret: true,
      value: role as any,
      visibleTo: [pId],
    };
  }

  // 人狼同士の可視性を設定
  const werewolfIds = playerIds.filter((id) => roleAssignment[id] === "werewolf");
  for (const wId of werewolfIds) {
    state.roles[wId].visibleTo = [wId, ...werewolfIds.filter((id) => id !== wId)];
  }

  // アクティブプレイヤー再設定（夜アクションが可能なプレイヤー）
  const nightActionRoles = ["werewolf", "seer", "guard"];
  state.activePlayers = playerIds.filter((id) => nightActionRoles.includes(roleAssignment[id]));

  return state;
}

describe("WerewolfRuleset", () => {
  const playerIds = ["p1", "p2", "p3", "p4", "p5"];

  describe("getInitialState", () => {
    test("should create initial state with correct player count", () => {
      const state = WerewolfRuleset.getInitialState({ playerIds });
      expect(state.playerIds).toEqual(playerIds);
      expect(state.alivePlayers).toEqual(playerIds);
      expect(state.deadPlayers).toHaveLength(0);
      expect(state.phase).toBe("NIGHT_ACTION");
      expect(state.day).toBe(1);
    });

    test("should assign roles to all players", () => {
      const state = WerewolfRuleset.getInitialState({ playerIds });
      for (const pId of playerIds) {
        expect(state.roles[pId]).toBeDefined();
        expect(state.roles[pId].__isSecret).toBe(true);
      }
    });

    test("should have correct role distribution for 5 players", () => {
      const state = WerewolfRuleset.getInitialState({ playerIds });
      const roles = playerIds.map((id) => state.roles[id].value);
      const werewolfCount = roles.filter((r) => r === "werewolf").length;
      const seerCount = roles.filter((r) => r === "seer").length;

      // 5人: 人狼1, 占い師1, 残り3人は村人
      expect(werewolfCount).toBe(1);
      expect(seerCount).toBe(1);
    });

    test("should have correct role distribution for 8 players", () => {
      const ids = ["p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8"];
      const state = WerewolfRuleset.getInitialState({ playerIds: ids });
      const roles = ids.map((id) => state.roles[id].value);
      const werewolfCount = roles.filter((r) => r === "werewolf").length;

      // 8人: 人狼2
      expect(werewolfCount).toBe(2);
    });
  });

  describe("getTeam", () => {
    test("should return correct team for each role", () => {
      expect(getTeam("villager")).toBe("village");
      expect(getTeam("seer")).toBe("village");
      expect(getTeam("guard")).toBe("village");
      expect(getTeam("medium")).toBe("village");
      expect(getTeam("werewolf")).toBe("werewolf");
    });
  });

  describe("isValidAction", () => {
    test("werewolf cannot attack another werewolf", () => {
      const state = createTestState({
        p1: "werewolf",
        p2: "werewolf",
        p3: "villager",
        p4: "seer",
        p5: "villager",
      });

      // p1(人狼)がp2(人狼)を襲撃 → 不正
      expect(
        WerewolfRuleset.isValidAction(state, {
          type: "NIGHT_ACTION",
          target: "p2",
          playerId: "p1",
        }),
      ).toBe(false);

      // p1(人狼)がp3(村人)を襲撃 → 合法
      expect(
        WerewolfRuleset.isValidAction(state, {
          type: "NIGHT_ACTION",
          target: "p3",
          playerId: "p1",
        }),
      ).toBe(true);
    });

    test("seer cannot divine themselves", () => {
      const state = createTestState({
        p1: "werewolf",
        p2: "villager",
        p3: "villager",
        p4: "seer",
        p5: "villager",
      });

      expect(
        WerewolfRuleset.isValidAction(state, {
          type: "NIGHT_ACTION",
          target: "p4",
          playerId: "p4",
        }),
      ).toBe(false);

      expect(
        WerewolfRuleset.isValidAction(state, {
          type: "NIGHT_ACTION",
          target: "p1",
          playerId: "p4",
        }),
      ).toBe(true);
    });

    test("guard cannot protect themselves", () => {
      const state = createTestState({
        p1: "werewolf",
        p2: "villager",
        p3: "villager",
        p4: "seer",
        p5: "guard",
      });

      expect(
        WerewolfRuleset.isValidAction(state, {
          type: "NIGHT_ACTION",
          target: "p5",
          playerId: "p5",
        }),
      ).toBe(false);
    });

    test("guard cannot protect same target consecutively", () => {
      const state = createTestState({
        p1: "werewolf",
        p2: "villager",
        p3: "villager",
        p4: "seer",
        p5: "guard",
      });
      state.lastGuardTarget = "p2";

      expect(
        WerewolfRuleset.isValidAction(state, {
          type: "NIGHT_ACTION",
          target: "p2",
          playerId: "p5",
        }),
      ).toBe(false);

      expect(
        WerewolfRuleset.isValidAction(state, {
          type: "NIGHT_ACTION",
          target: "p3",
          playerId: "p5",
        }),
      ).toBe(true);
    });

    test("dead players cannot act", () => {
      const state = createTestState({
        p1: "werewolf",
        p2: "villager",
        p3: "villager",
        p4: "seer",
        p5: "villager",
      });
      state.alivePlayers = ["p1", "p3", "p4", "p5"]; // p2 is dead

      expect(
        WerewolfRuleset.isValidAction(state, {
          type: "NIGHT_ACTION",
          target: "p3",
          playerId: "p2",
        }),
      ).toBe(false);
    });

    test("villager has no night action", () => {
      const state = createTestState({
        p1: "werewolf",
        p2: "villager",
        p3: "villager",
        p4: "seer",
        p5: "villager",
      });

      expect(
        WerewolfRuleset.isValidAction(state, {
          type: "NIGHT_ACTION",
          target: "p1",
          playerId: "p2",
        }),
      ).toBe(false);
    });

    test("vote is only valid during DAY_VOTE phase", () => {
      const state = createTestState({
        p1: "werewolf",
        p2: "villager",
        p3: "villager",
        p4: "seer",
        p5: "villager",
      });
      state.phase = "DAY_VOTE";
      state.activePlayers = state.alivePlayers;

      expect(
        WerewolfRuleset.isValidAction(state, {
          type: "VOTE",
          target: "p1",
          playerId: "p2",
        }),
      ).toBe(true);

      // NIGHT_ACTION phase で VOTE は不正
      state.phase = "NIGHT_ACTION";
      expect(
        WerewolfRuleset.isValidAction(state, {
          type: "VOTE",
          target: "p1",
          playerId: "p2",
        }),
      ).toBe(false);
    });
  });

  describe("reduce - night phase", () => {
    test("should resolve night attack and transition to day", () => {
      const state = createTestState({
        p1: "werewolf",
        p2: "villager",
        p3: "villager",
        p4: "seer",
        p5: "villager",
      });

      // 人狼がp2を襲撃
      let next = WerewolfRuleset.reduce(state, {
        type: "NIGHT_ACTION",
        target: "p2",
        playerId: "p1",
      });

      // 占い師がp1を占う
      next = WerewolfRuleset.reduce(next, {
        type: "NIGHT_ACTION",
        target: "p1",
        playerId: "p4",
      });

      // 夜が解決され、昼の議論フェーズへ
      expect(next.phase).toBe("DAY_DISCUSSION");
      expect(next.alivePlayers).not.toContain("p2");
      expect(next.deadPlayers).toHaveLength(1);
      expect(next.deadPlayers[0].playerId).toBe("p2");
      expect(next.deadPlayers[0].cause).toBe("attacked");
    });

    test("guard should protect from werewolf attack", () => {
      const state = createTestState({
        p1: "werewolf",
        p2: "villager",
        p3: "villager",
        p4: "seer",
        p5: "guard",
      });

      // 人狼がp2を襲撃
      let next = WerewolfRuleset.reduce(state, {
        type: "NIGHT_ACTION",
        target: "p2",
        playerId: "p1",
      });

      // 占い師がp1を占う
      next = WerewolfRuleset.reduce(next, {
        type: "NIGHT_ACTION",
        target: "p1",
        playerId: "p4",
      });

      // 騎士がp2を護衛
      next = WerewolfRuleset.reduce(next, {
        type: "NIGHT_ACTION",
        target: "p2",
        playerId: "p5",
      });

      // 護衛成功でp2は生存
      expect(next.phase).toBe("DAY_DISCUSSION");
      expect(next.alivePlayers).toContain("p2");
      expect(next.deadPlayers).toHaveLength(0);
      expect(next.lastNightResult?.guardSuccess).toBe(true);
    });

    test("seer should receive divination result", () => {
      const state = createTestState({
        p1: "werewolf",
        p2: "villager",
        p3: "villager",
        p4: "seer",
        p5: "villager",
      });

      // 人狼がp2を襲撃
      let next = WerewolfRuleset.reduce(state, {
        type: "NIGHT_ACTION",
        target: "p2",
        playerId: "p1",
      });

      // 占い師がp1（人狼）を占う
      next = WerewolfRuleset.reduce(next, {
        type: "NIGHT_ACTION",
        target: "p1",
        playerId: "p4",
      });

      // 占い結果が記録されている
      expect(next.seerResults["p4"]).toBeDefined();
      expect(next.seerResults["p4"].value).toHaveLength(1);
      expect(next.seerResults["p4"].value[0].target).toBe("p1");
      expect(next.seerResults["p4"].value[0].team).toBe("werewolf");
    });
  });

  describe("reduce - day phase", () => {
    test("should transition from discussion to vote when all skip", () => {
      const state = createTestState({
        p1: "werewolf",
        p2: "villager",
        p3: "villager",
        p4: "seer",
        p5: "villager",
      });
      state.phase = "DAY_DISCUSSION";
      state.activePlayers = [...state.alivePlayers];

      let next = state;
      for (const pId of state.alivePlayers) {
        next = WerewolfRuleset.reduce(next, {
          type: "SKIP_DISCUSSION",
          playerId: pId,
        });
      }

      expect(next.phase).toBe("DAY_VOTE");
    });

    test("should execute player with most votes", () => {
      const state = createTestState({
        p1: "werewolf",
        p2: "villager",
        p3: "villager",
        p4: "seer",
        p5: "villager",
      });
      state.phase = "DAY_VOTE";
      state.activePlayers = [...state.alivePlayers];
      state.votes = {};

      // 3人がp1に投票、2人がp2に投票
      let next = WerewolfRuleset.reduce(state, {
        type: "VOTE",
        target: "p1",
        playerId: "p2",
      });
      next = WerewolfRuleset.reduce(next, {
        type: "VOTE",
        target: "p1",
        playerId: "p3",
      });
      next = WerewolfRuleset.reduce(next, {
        type: "VOTE",
        target: "p1",
        playerId: "p4",
      });
      next = WerewolfRuleset.reduce(next, {
        type: "VOTE",
        target: "p2",
        playerId: "p5",
      });
      next = WerewolfRuleset.reduce(next, {
        type: "VOTE",
        target: "p2",
        playerId: "p1",
      });

      // p1(人狼)が処刑される
      expect(next.alivePlayers).not.toContain("p1");
      expect(next.deadPlayers.find((d) => d.playerId === "p1")?.cause).toBe("executed");
      expect(next.lastExecutedPlayerId).toBe("p1");
    });
  });

  describe("checkWinCondition", () => {
    test("village wins when all werewolves are dead", () => {
      const state = createTestState({
        p1: "werewolf",
        p2: "villager",
        p3: "villager",
        p4: "seer",
        p5: "villager",
      });
      state.alivePlayers = ["p2", "p3", "p4", "p5"]; // 人狼p1は死亡

      const result = WerewolfRuleset.checkWinCondition(state);
      expect(result.isFinished).toBe(true);
      expect(result.winnerIds).toContain("p2");
      expect(result.winnerIds).toContain("p4");
      expect(result.winnerIds).not.toContain("p1");
    });

    test("werewolves win when they outnumber villagers", () => {
      const state = createTestState({
        p1: "werewolf",
        p2: "villager",
        p3: "villager",
        p4: "seer",
        p5: "villager",
      });
      state.alivePlayers = ["p1", "p2"]; // 人狼1:村人1 → 人狼勝利

      const result = WerewolfRuleset.checkWinCondition(state);
      expect(result.isFinished).toBe(true);
      expect(result.winnerIds).toContain("p1");
    });

    test("game continues when both sides are alive and unbalanced", () => {
      const state = createTestState({
        p1: "werewolf",
        p2: "villager",
        p3: "villager",
        p4: "seer",
        p5: "villager",
      });
      state.alivePlayers = ["p1", "p2", "p3", "p4"]; // 人狼1:村人3 → 継続

      const result = WerewolfRuleset.checkWinCondition(state);
      expect(result.isFinished).toBe(false);
    });
  });

  describe("getLegalActions", () => {
    test("werewolf should get night actions for non-werewolf targets", () => {
      const state = createTestState({
        p1: "werewolf",
        p2: "villager",
        p3: "villager",
        p4: "seer",
        p5: "villager",
      });

      const actions = WerewolfRuleset.getLegalActions(state, "p1");
      expect(actions.length).toBeGreaterThan(0);
      expect(actions.every((a) => a.type === "NIGHT_ACTION")).toBe(true);
      // 人狼は自分以外の人狼をターゲットにできない
      expect(actions.some((a) => a.target === "p1")).toBe(false);
    });

    test("villager should have no night actions", () => {
      const state = createTestState({
        p1: "werewolf",
        p2: "villager",
        p3: "villager",
        p4: "seer",
        p5: "villager",
      });

      const actions = WerewolfRuleset.getLegalActions(state, "p2");
      expect(actions).toHaveLength(0);
    });

    test("should return vote actions during DAY_VOTE phase", () => {
      const state = createTestState({
        p1: "werewolf",
        p2: "villager",
        p3: "villager",
        p4: "seer",
        p5: "villager",
      });
      state.phase = "DAY_VOTE";
      state.activePlayers = [...state.alivePlayers];
      state.votes = {};

      const actions = WerewolfRuleset.getLegalActions(state, "p2");
      expect(actions.length).toBeGreaterThan(0);
      expect(actions.every((a) => a.type === "VOTE")).toBe(true);
    });

    test("should return skip discussion action during DAY_DISCUSSION", () => {
      const state = createTestState({
        p1: "werewolf",
        p2: "villager",
        p3: "villager",
        p4: "seer",
        p5: "villager",
      });
      state.phase = "DAY_DISCUSSION";
      state.activePlayers = [...state.alivePlayers];

      const actions = WerewolfRuleset.getLegalActions(state, "p2");
      expect(actions).toHaveLength(1);
      expect(actions[0].type).toBe("SKIP_DISCUSSION");
    });
  });

  describe("full game simulation", () => {
    test("village wins by executing the werewolf", () => {
      const state = createTestState({
        p1: "werewolf",
        p2: "villager",
        p3: "villager",
        p4: "seer",
        p5: "villager",
      });

      // === Night 1 ===
      // 人狼がp2を襲撃
      let next = WerewolfRuleset.reduce(state, {
        type: "NIGHT_ACTION",
        target: "p2",
        playerId: "p1",
      });
      // 占い師がp1を占う
      next = WerewolfRuleset.reduce(next, {
        type: "NIGHT_ACTION",
        target: "p1",
        playerId: "p4",
      });

      expect(next.phase).toBe("DAY_DISCUSSION");
      expect(next.alivePlayers).not.toContain("p2");

      // === Day 1: Discussion ===
      for (const pId of [...next.alivePlayers]) {
        next = WerewolfRuleset.reduce(next, {
          type: "SKIP_DISCUSSION",
          playerId: pId,
        });
      }
      expect(next.phase).toBe("DAY_VOTE");

      // === Day 1: Vote — 全員がp1(人狼)に投票 ===
      const voters = [...next.alivePlayers];
      for (const pId of voters) {
        next = WerewolfRuleset.reduce(next, {
          type: "VOTE",
          target: "p1",
          playerId: pId,
        });
      }

      // 人狼p1が処刑され、村人陣営の勝利
      expect(next.alivePlayers).not.toContain("p1");
      const result = WerewolfRuleset.checkWinCondition(next);
      expect(result.isFinished).toBe(true);
      expect(result.winnerIds).not.toContain("p1");
      expect(result.message).toContain("村人陣営の勝利");
    });
  });
});
