import { expect, test, describe, beforeEach } from "bun:test";
import request from "supertest";
import express from "express";
import jwt from "jsonwebtoken";
import gameRoutes from "./game";
import { sessions, repo, createSession } from "../store/sessionStore";
import { setIoInstance } from "../socket/roomManager";
import { JWT_SECRET } from "../config";
import { UniversalEngine } from "@engine/shared/UniversalEngine";
import { TicTacToeRuleset } from "@engine/shared/rules/TicTacToeRuleset";

// Mock Socket.IO Server
const mockIo = {
  to: () => ({ emit: () => {} }),
  in: () => ({ fetchSockets: async () => [] }),
  local: { in: () => ({ fetchSockets: async () => [] }) },
} as any;

const app = express();
app.use(express.json());
app.use("/", gameRoutes);

describe("Game Routes", () => {
  beforeEach(async () => {
    setIoInstance(mockIo);
    sessions.clear();
    for (const { gameId } of await repo.listSessions()) await repo.deleteSession(gameId);

    // 2 人着席済み・PLAYING の三目並べをストアに保存しておく
    const engine = new UniversalEngine(TicTacToeRuleset, {});
    engine.dispatch({ type: "JOIN", playerId: "user1" } as any);
    engine.dispatch({ type: "JOIN", playerId: "user2" } as any);
    engine.dispatch({ type: "START", playerId: "user1" } as any);
    createSession("game1", engine, "tictactoe");
    await sessions.get("game1")!.server.commit();
  });

  test("POST /:gameId/leave should remove player from game", async () => {
    const token = jwt.sign({ userId: "user1" }, JWT_SECRET);
    const response = await request(app)
      .post("/game1/leave")
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);
    const state = sessions.get("game1")?.server.engine.getState();
    expect(state.players[1]).toBeNull();
    // ストアにも反映されている
    const saved = await repo.loadSession("game1");
    expect(saved?.state.players[1]).toBeNull();
  });

  test("POST /:gameId/leave should return 404 for unknown game", async () => {
    const token = jwt.sign({ userId: "user1" }, JWT_SECRET);
    const response = await request(app).post("/nope/leave").set("Authorization", `Bearer ${token}`);
    expect(response.status).toBe(404);
  });

  test("GET /:gameId/state should return current state", async () => {
    const token = jwt.sign({ userId: "user1" }, JWT_SECRET);
    const response = await request(app).get("/game1/state").set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.state.status).toBe("PLAYING");
  });

  test("GET /:gameId/state should restore a session that is not cached locally", async () => {
    // 別インスタンスで作られた対局を模す
    sessions.clear();
    const token = jwt.sign({ userId: "user1" }, JWT_SECRET);
    const response = await request(app).get("/game1/state").set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.state.status).toBe("PLAYING");
    expect(sessions.has("game1")).toBe(true);
  });

  test("POST /:gameId/action should update game state", async () => {
    const token = jwt.sign({ userId: "user1" }, JWT_SECRET);
    const response = await request(app)
      .post("/game1/action")
      .set("Authorization", `Bearer ${token}`)
      .send({ type: "PLACE", index: 0 });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.state.board[0]).toBe(1);
  });

  test("POST /:gameId/action should return 400 for invalid action", async () => {
    const token = jwt.sign({ userId: "user2" }, JWT_SECRET); // It's user1's turn
    const response = await request(app)
      .post("/game1/action")
      .set("Authorization", `Bearer ${token}`)
      .send({ type: "PLACE", index: 0 });

    expect(response.status).toBe(400);
    expect(response.body.error).toBeDefined();
  });
});
