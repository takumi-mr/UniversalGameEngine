import { expect, test, describe, beforeEach } from "bun:test";
import request from "supertest";
import express from "express";
import jwt from "jsonwebtoken";
import roomsRoutes from "@engine/backend/routes/rooms";
import { sessions, repo, createSession } from "@engine/backend/store/sessionStore";
import { setIoInstance } from "@engine/backend/socket/roomManager";
import { JWT_SECRET } from "@engine/backend/config";
import { UniversalEngine } from "@engine/shared/UniversalEngine";
import { TicTacToeRuleset } from "@engine/shared/rules/TicTacToeRuleset";
import { OthelloRuleset } from "@engine/shared/rules/OthelloRuleset";
import type { Server } from "socket.io";

// Mock Socket.IO Server（fetchSockets はクラスタ全体のソケットを返す想定）
const roomSockets = new Map<string, { id: string }[]>([
  ["room1", [{ id: "a" }, { id: "b" }]],
  ["room2", [{ id: "c" }]],
]);
const mockIo = {
  in: (room: string) => ({ fetchSockets: async () => roomSockets.get(room) ?? [] }),
  local: { in: () => ({ fetchSockets: async () => [] }) },
  to: () => ({ emit: () => {} }),
} as unknown as Server;

const app = express();
app.use(express.json());
app.use("/", roomsRoutes);

describe("Rooms Routes", () => {
  beforeEach(async () => {
    setIoInstance(mockIo);
    sessions.clear();
    for (const { gameId } of await repo.listSessions()) await repo.deleteSession(gameId);

    // セッションはストアに保存されたものが一覧に出る（メモリキャッシュではない）
    const engine1 = new UniversalEngine(TicTacToeRuleset, {});
    engine1.dispatch({ type: "JOIN", playerId: "user1" });
    engine1.dispatch({ type: "JOIN", playerId: "user2" });
    createSession("room1", engine1, "tictactoe");
    await sessions.get("room1")!.server.commit();

    const engine2 = new UniversalEngine(OthelloRuleset, {});
    engine2.dispatch({ type: "JOIN", playerId: "user3" });
    createSession("room2", engine2, "othello");
    await sessions.get("room2")!.server.commit();

    // gRPC ボットが着席した部屋（外部ボットはこの bots から自分の席を見つける）
    const engine3 = new UniversalEngine(OthelloRuleset, {});
    engine3.dispatch({ type: "JOIN", playerId: "bot_1_abc", slot: "-1" });
    createSession("room3", engine3, "othello");
    sessions
      .get("room3")!
      .server.addBot({ playerId: "bot_1_abc", aiType: "grpc_bot", name: "grpc_bot 1" });
    await sessions.get("room3")!.server.commit();

    // 別インスタンスで作られた部屋を模す: このインスタンスのキャッシュにはない
    sessions.clear();
  });

  test("GET / should return all rooms", async () => {
    const response = await request(app).get("/");
    expect(response.status).toBe(200);
    expect(response.body.rooms).toHaveLength(3);
    expect(response.body.rooms).toEqual(
      expect.arrayContaining([
        { id: "room1", type: "tictactoe", playerCount: 2, bots: [] },
        { id: "room2", type: "othello", playerCount: 1, bots: [] },
      ]),
    );
  });

  test("GET /my should return rooms the user is in", async () => {
    const token = jwt.sign({ userId: "User1" }, JWT_SECRET);
    const response = await request(app).get("/my").set("Authorization", `Bearer ${token}`);
    expect(response.status).toBe(200);
    expect(response.body.rooms).toHaveLength(1);
    expect(response.body.rooms[0].id).toBe("room1");
  });

  test("GET /my should return 401 without token", async () => {
    const response = await request(app).get("/my");
    expect(response.status).toBe(401);
  });

  test("GET /:gameType should filter rooms by type and include seated bots", async () => {
    const response = await request(app).get("/othello");
    expect(response.status).toBe(200);
    expect(response.body.rooms).toHaveLength(2);
    expect(response.body.rooms).toEqual(
      expect.arrayContaining([
        { id: "room2", type: "othello", playerCount: 1, bots: [] },
        {
          id: "room3",
          type: "othello",
          playerCount: 0,
          bots: [{ playerId: "bot_1_abc", aiType: "grpc_bot", name: "grpc_bot 1" }],
        },
      ]),
    );
  });
});
