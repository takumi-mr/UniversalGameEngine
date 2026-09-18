// apps/backend/store/deadlineSweeper.test.ts
// commit() が締切を予約し、sweepDeadlines() が期限の来た締切に TIMEOUT を dispatch することを検証する。
import { describe, it, expect, beforeEach } from "bun:test";
import { sessions, repo, createSession, withSession } from "@engine/backend/store/sessionStore";
import { sweepDeadlines } from "@engine/backend/store/deadlineSweeper";
import { setIoInstance } from "@engine/backend/network/io";
import { UniversalEngine, type EngineReplayData } from "@engine/shared/UniversalEngine";
import {
  CaveDiveRuleset,
  type CaveDiveAction,
  type CaveDiveState,
} from "@engine/shared/rules/CaveDiveRuleset";
import type { InMemoryDummyRepository } from "@engine/backend/infra/InMemoryDummyRepository";
import type { Server } from "socket.io";

const mockIo = {
  in: () => ({ fetchSockets: async () => [] }),
  local: { in: () => ({ fetchSockets: async () => [] }) },
  to: () => ({ emit: () => {} }),
} as unknown as Server;

const memRepo = repo as unknown as InMemoryDummyRepository<CaveDiveState>;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 2 人で開始した『掘るか、逃げるか』。decisionTimeMs で締切までの時間を指定 */
async function startCave(gameId: string, decisionTimeMs: number) {
  const engine = new UniversalEngine<CaveDiveState, CaveDiveAction>(CaveDiveRuleset, {
    decisionTimeMs,
  });
  engine.dispatch({ type: "JOIN", playerId: "a" });
  engine.dispatch({ type: "JOIN", playerId: "b" });
  const { server } = createSession(gameId, engine, "cave_dive");
  // START は dispatchAction 経由で timestamp が付く
  expect(await server.dispatchAction("a", { type: "START" })).toBe(true);
  return server;
}

describe("deadlineSweeper", () => {
  beforeEach(async () => {
    setIoInstance(mockIo);
    sessions.clear();
    for (const { gameId } of await repo.listSessions()) await repo.deleteSession(gameId);
  });

  it("commit は state.turnDeadline を予約し、締切が無くなれば取り消す", async () => {
    const server = await startCave("d1", 60_000);
    const state = server.engine.getState() as CaveDiveState;
    expect(state.turnDeadline).toBeDefined();
    expect(memRepo.getScheduledDeadline("d1")).toBe(state.turnDeadline);

    // 終局すれば予約は消える
    server.engine.loadState(
      { ...state, status: "FINISHED", turnDeadline: undefined },
      server.engine.getReplayData(),
    );
    await withSession("d1", async (s) => s.server.commit());
    expect(memRepo.getScheduledDeadline("d1")).toBeUndefined();
  });

  it("期限前は何もせず、期限が来たら手番全員に TIMEOUT を dispatch して次の締切を予約し直す", async () => {
    const server = await startCave("d2", 30);
    const before = server.engine.getState() as CaveDiveState;
    const deadline = before.turnDeadline!;

    // まだ期限前（予約は残る）
    expect(await sweepDeadlines(deadline - 10)).toEqual([]);
    expect(memRepo.getScheduledDeadline("d2")).toBe(deadline);

    // 期限を過ぎるまで待ってから掃く（dispatchAction が付ける timestamp が締切以降である必要がある）
    await sleep(40);
    expect(await sweepDeadlines()).toEqual(["d2"]);

    const after = server.engine.getState() as CaveDiveState;
    // 両者とも LEAVE 扱い → ラウンドが終わり次のラウンドが始まっている
    expect(after.round).toBe(2);
    expect(after.revealedChoices).toBeNull(); // 新ラウンドでリセット
    expect(server.engine.history.filter((a) => a.type === "TIMEOUT").length).toBe(2);
    // 次の分岐点の締切が予約されている
    expect(after.turnDeadline).toBeGreaterThan(deadline);
    expect(memRepo.getScheduledDeadline("d2")).toBe(after.turnDeadline);
    // ストアにも反映されている
    expect((await repo.loadSession("d2"))!.state.version).toBe(after.version);
  });

  it("取り出した後に別インスタンスが手を進めて締切が延びていたら、予約を戻すだけ", async () => {
    const server = await startCave("d3", 30);
    const first = server.engine.getState() as CaveDiveState;
    await sleep(40);

    // 別インスタンスが両者の選択を進めた（ストアだけ更新）: 新しい締切は未来
    const other = new UniversalEngine<CaveDiveState, CaveDiveAction>(CaveDiveRuleset, {
      decisionTimeMs: 60_000,
    });
    // ストアはゲーム共通の BaseGameState で保存しているので CaveDive の型に戻す
    const saved = (await memRepo.loadSession("d3"))!;
    other.loadState(
      structuredClone(saved.state),
      structuredClone(saved.replay!) as EngineReplayData<CaveDiveState, CaveDiveAction>,
    );
    const now = Date.now();
    other.dispatch({ type: "CHOOSE", playerId: "a", choice: "STAY", timestamp: now });
    other.dispatch({ type: "CHOOSE", playerId: "b", choice: "STAY", timestamp: now });
    const advanced = other.getState() as CaveDiveState;
    // decisionTimeMs は元のセッションの値（30ms）なので、締切を明示的に未来へ
    const future = { ...advanced, turnDeadline: now + 60_000 };
    await repo.saveSession("d3", {
      type: "cave_dive",
      state: future,
      replay: other.getReplayData(),
    });

    expect(await sweepDeadlines()).toEqual([]);
    expect(memRepo.getScheduledDeadline("d3")).toBe(now + 60_000);
    // このインスタンスのキャッシュも最新化され、TIMEOUT は 1 つも入っていない
    const local = server.engine.getState() as CaveDiveState;
    expect(local.version).toBe(future.version);
    expect(first.version!).toBeLessThan(local.version!);
    expect(server.engine.history.some((a) => a.type === "TIMEOUT")).toBe(false);
  });
});
