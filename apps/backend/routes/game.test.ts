import { expect, test, describe, beforeEach, spyOn } from "bun:test";
import request from "supertest";
import express from "express";
import jwt from "jsonwebtoken";
import gameRoutes from "./game";
import { sessions, repo } from "../store/sessionStore";
import { setIoInstance } from "../socket/roomManager";
import { JWT_SECRET } from "../config";
import { UniversalEngine } from "@engine/shared/UniversalEngine";
import { TicTacToeRuleset } from "@engine/shared/rules/TicTacToeRuleset";

// Mock Socket.IO Server
const mockIo = {
  to: () => ({ emit: () => {} }),
  sockets: {
    adapter: {
      rooms: new Map(),
    },
  },
} as any;

const app = express();
app.use(express.json());
app.use("/", gameRoutes);

describe("Game Routes", () => {
  beforeEach(() => {
    setIoInstance(mockIo);
    sessions.clear();

    // Spy on repo methods to avoid real DB calls
    spyOn(repo, "save").mockImplementation(() => Promise.resolve());
    spyOn(repo, "load").mockImplementation(() => Promise.resolve(null));
    spyOn(repo, "delete").mockImplementation(() => Promise.resolve());

    // Setup mock sessions
    const engine = new UniversalEngine(TicTacToeRuleset, {});
    engine.loadState({
      status: "PLAYING",
      version: 1,
      board: Array(9).fill(0),
      turn: 1,
      players: { 1: "user1", "-1": "user2" },
    } as any);

    sessions.set("game1", {
      type: "tictactoe",
      server: {
        engine,
        broadcastState: () => {},
        getPollingState: (userId: string) => engine.getMaskedState(userId),
        handleAction: (userId: string, action: any) =>
          engine.dispatch({ ...action, playerId: userId }),
      } as any,
    });
  });

  test("POST /:gameId/leave should remove player from game", async () => {
    const token = jwt.sign({ userId: "user1" }, JWT_SECRET);
    const response = await request(app)
      .post("/game1/leave")
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);
    const state = sessions.get("game1")?.server.engine.getState();
    expect(state.players[1]).toBeNull();
  });

  test("GET /:gameId/state should return current state", async () => {
    const token = jwt.sign({ userId: "user1" }, JWT_SECRET);
    const response = await request(app).get("/game1/state").set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.state.status).toBe("PLAYING");
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
