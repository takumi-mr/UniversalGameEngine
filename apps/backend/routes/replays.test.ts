// apps/backend/routes/replays.test.ts
// リプレイ記録は終局するまで返さない（対局中の記録には初期状態・サーバーシード・全アクションが入っている）
import { expect, test, describe, beforeEach } from "bun:test";
import request from "supertest";
import express from "express";
import replaysRoutes from "@engine/backend/routes/replays";
import {
  sessions,
  repo,
  createSession,
  SocketGameServer,
} from "@engine/backend/store/sessionStore";
import { setIoInstance } from "@engine/backend/socket/roomManager";
import { UniversalEngine } from "@engine/shared/UniversalEngine";
import { TicTacToeRuleset } from "@engine/shared/rules/TicTacToeRuleset";
import type { Server } from "socket.io";

const mockIo = {
  to: () => ({ emit: () => {} }),
  in: () => ({ fetchSockets: async () => [] }),
  local: { in: () => ({ fetchSockets: async () => [] }) },
} as unknown as Server;

const app = express();
app.use("/replays", replaysRoutes);

describe("Replay Routes", () => {
  beforeEach(async () => {
    setIoInstance(mockIo);
    sessions.clear();
    for (const { gameId } of await repo.listSessions()) await repo.deleteSession(gameId);
  });

  test("GET /replays/:gameId は終局するまで 404 を返し、終局後は記録を返す", async () => {
    // 1 手ごとに記録へ追記させ、対局中でも記録が存在する状況を作る
    const original = SocketGameServer.replayFlushSize;
    SocketGameServer.replayFlushSize = 1;
    try {
      const engine = new UniversalEngine(TicTacToeRuleset, {});
      engine.dispatch({ type: "JOIN", playerId: "p1" });
      engine.dispatch({ type: "JOIN", playerId: "p2" });
      engine.dispatch({ type: "START", playerId: "p1" });
      const { server } = createSession("r1", engine, "tictactoe");
      await server.commit();
      expect(await server.dispatchAction("p1", { type: "PLACE", index: 0 })).toBe(true);

      // 記録はあるが、対局中は返さない
      expect(await repo.loadGameRecord("r1")).not.toBeNull();
      expect((await request(app).get("/replays/r1")).status).toBe(404);

      // p1 が上段を揃えて終局
      for (const [player, index] of [
        ["p2", 3],
        ["p1", 1],
        ["p2", 4],
        ["p1", 2],
      ] as const) {
        expect(await server.dispatchAction(player, { type: "PLACE", index })).toBe(true);
      }
      expect(server.engine.getState().status).toBe("FINISHED");

      const response = await request(app).get("/replays/r1");
      expect(response.status).toBe(200);
      expect(response.body.gameId).toBe("r1");
      expect(response.body.finalServerSeed).toBeTruthy();
      expect(response.body.actions.length).toBe(8); // JOIN ×2 + START + 5 手
    } finally {
      SocketGameServer.replayFlushSize = original;
    }
  });

  test("GET /replays/:gameId は存在しない記録に 404 を返す", async () => {
    expect((await request(app).get("/replays/nope")).status).toBe(404);
  });
});
