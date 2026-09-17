// apps/backend/store/cyberStrike.integration.test.ts
// サーバー側の流れ: 1 人で自動開始（CPU が相手）→ クライアントの INPUT / ハートビートで物理が時刻駆動で進む
// → 2 人目の着席で CPU と交代 → 終局後の RESET。dispatchAction が付ける playerId / timestamp を前提にする。
import { describe, it, expect, beforeEach } from "bun:test";
import { sessions, repo, createSession, withSession } from "./sessionStore";
import { setIoInstance } from "../network/io";
import { UniversalEngine } from "@engine/shared/UniversalEngine";
import {
  CyberStrikeRuleset,
  BOT_ID,
  type CyberStrikeState,
  type CyberStrikeAction,
} from "@engine/shared/rules/CyberStrikeRuleset";

const mockIo = {
  in: () => ({ fetchSockets: async () => [] }),
  local: { in: () => ({ fetchSockets: async () => [] }) },
  to: () => ({ emit: () => {} }),
} as any;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function startSolo(gameId: string) {
  const engine = new UniversalEngine<CyberStrikeState, CyberStrikeAction>(CyberStrikeRuleset, {});
  engine.dispatch({ type: "JOIN", playerId: "alice" });
  const { server } = createSession(gameId, engine, "cyber_strike");
  // socket/index.ts の自動開始と同じ: 着席者が minPlayers 以上なら START
  expect(await server.dispatchAction("alice", { type: "START" })).toBe(true);
  return server;
}

describe("CyberStrike on the server", () => {
  beforeEach(async () => {
    setIoInstance(mockIo);
    sessions.clear();
    for (const { gameId } of await repo.listSessions()) await repo.deleteSession(gameId);
  });

  it("1 人で開始すると CPU が相手になり、INPUT とハートビートで物理が進む", async () => {
    const server = await startSolo("cs1");
    let s = server.engine.getState() as CyberStrikeState;
    expect(s.status).toBe("PLAYING");
    expect(s.botId).toBe(BOT_ID);
    expect(s.startedAt).toBeDefined();
    expect(s.players).toEqual({ "0": "alice", "1": null });

    // クライアントから届く INPUT（playerId と timestamp はサーバーが付け直す）
    await sleep(120);
    expect(
      await server.dispatchAction("alice", {
        type: "INPUT",
        seq: 1,
        input: { moveX: 1, moveY: 0 },
      }),
    ).toBe(true);
    s = server.engine.getState() as CyberStrikeState;
    expect(s.tick).toBeGreaterThanOrEqual(3);
    expect(s.playersData.alice.lastProcessedSeq).toBe(1);
    expect(s.playersData.alice.vx).toBeGreaterThan(0);

    // 無入力時のハートビート（クライアントは TICK を送る。playerId が付いても受け付ける）
    await sleep(120);
    expect(await server.dispatchAction("alice", { type: "TICK" })).toBe(true);
    const after = server.engine.getState() as CyberStrikeState;
    expect(after.tick).toBeGreaterThan(s.tick);
    expect(after.playersData.alice.x).toBeGreaterThan(120);
    // CPU も動いている
    expect(after.playersData[BOT_ID].x).not.toBe(800 - 120);
    // 保存されている
    expect((await repo.loadSession("cs1"))!.state.version).toBe(after.version);
  });

  it("他人の INPUT は送信者の入力として扱われるので、CPU を客が操作することはできない", async () => {
    const server = await startSolo("cs2");
    // クライアントが cpu_bot の入力を送っても playerId は alice に付け替えられる
    expect(
      await server.dispatchAction("alice", {
        type: "INPUT",
        playerId: BOT_ID,
        input: { moveX: -1, moveY: 0 },
      }),
    ).toBe(true);
    const s = server.engine.getState() as CyberStrikeState;
    expect(s.playersData.alice.vx).toBeLessThan(0);
    expect(server.engine.history.at(-1)?.playerId).toBe("alice");
  });

  it("2 人目が着席すると CPU と交代し、その人の INPUT が通る", async () => {
    const server = await startSolo("cs3");
    await sleep(50);
    await server.dispatchAction("alice", { type: "TICK" });

    // socket/index.ts の join-game と同じ: ロック内でエンジンの組み込み JOIN → commit
    await withSession("cs3", async (sess) => {
      expect(sess.server.engine.dispatch({ type: "JOIN", playerId: "bob" })).toBe(true);
      await sess.server.commit();
    });
    let s = server.engine.getState() as CyberStrikeState;
    expect(s.botId).toBeNull();
    expect(s.playersData[BOT_ID]).toBeUndefined();
    expect(s.playersData.bob).toBeDefined();
    expect(s.players).toEqual({ "0": "alice", "1": "bob" });

    expect(
      await server.dispatchAction("bob", { type: "INPUT", seq: 1, input: { moveX: 0, moveY: -1 } }),
    ).toBe(true);
    s = server.engine.getState() as CyberStrikeState;
    expect(s.playersData.bob.vy).toBeLessThan(0);
    expect(s.playersData.bob.lastProcessedSeq).toBe(1);
  });

  it("終局後に着席者が RESET すると新しい試合が始まる", async () => {
    const server = await startSolo("cs4");
    // 相手を撃破した状態にして終局させる
    const s = server.engine.getState() as CyberStrikeState;
    const dying = structuredClone(s);
    dying.playersData[BOT_ID].hp = 18;
    dying.playersData[BOT_ID].x = 180;
    dying.playersData[BOT_ID].y = 250;
    server.engine.loadState(dying, server.engine.getReplayData());
    expect(
      await server.dispatchAction("alice", {
        type: "INPUT",
        input: { moveX: 0, moveY: 0, fire: true, aimAngle: 0 },
      }),
    ).toBe(true);
    await sleep(400);
    await server.dispatchAction("alice", { type: "TICK" });
    let after = server.engine.getState() as CyberStrikeState;
    expect(after.status).toBe("FINISHED");
    expect(after.message).toContain("alice wins");

    expect(await server.dispatchAction("stranger", { type: "RESET" })).toBe(false);
    expect(await server.dispatchAction("alice", { type: "RESET" })).toBe(true);
    after = server.engine.getState() as CyberStrikeState;
    expect(after.status).toBe("PLAYING");
    expect(after.tick).toBe(0);
    expect(after.playersData[BOT_ID].hp).toBe(100);
  });
});
