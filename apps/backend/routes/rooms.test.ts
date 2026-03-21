import { expect, test, describe, beforeEach } from "bun:test";
import request from "supertest";
import express from "express";
import jwt from "jsonwebtoken";
import roomsRoutes from "./rooms";
import { sessions } from "../store/sessionStore";
import { setIoInstance } from "../socket/roomManager";
import { JWT_SECRET } from "../config";
import { UniversalEngine } from "@engine/shared/UniversalEngine";
import { TicTacToeRuleset } from "@engine/shared/rules/TicTacToeRuleset";

// Mock Socket.IO Server
const mockIo = {
    sockets: {
        adapter: {
            rooms: new Map([
                ["room1", { size: 2 }],
                ["room2", { size: 1 }]
            ])
        }
    }
} as any;

const app = express();
app.use(express.json());
app.use("/", roomsRoutes);

describe("Rooms Routes", () => {
    beforeEach(() => {
        setIoInstance(mockIo);
        sessions.clear();

        // Setup mock sessions
        const engine1 = new UniversalEngine(TicTacToeRuleset, {});
        engine1.loadState({
            status: "PLAYING",
            version: 1,
            board: [],
            turn: 1,
            players: { 1: "user1", "-1": "user2" }
        } as any);

        sessions.set("room1", {
            type: "tictactoe",
            server: { engine: engine1 } as any
        });

        sessions.set("room2", {
            type: "othello",
            server: {
                engine: {
                    getState: () => ({ players: { 1: "user3" } })
                }
            } as any
        });
    });

    test("GET / should return all rooms", async () => {
        const response = await request(app).get("/");
        expect(response.status).toBe(200);
        expect(response.body.rooms.length).toBe(2);
        expect(response.body.rooms[0].id).toBe("room1");
        expect(response.body.rooms[0].playerCount).toBe(2);
    });

    test("GET /:gameType should filter rooms", async () => {
        const response = await request(app).get("/tictactoe");
        expect(response.status).toBe(200);
        expect(response.body.rooms.length).toBe(1);
        expect(response.body.rooms[0].type).toBe("tictactoe");
    });

    test("GET /my should return rooms for the logged-in user", async () => {
        const token = jwt.sign({ userId: "user1" }, JWT_SECRET);
        const response = await request(app)
            .get("/my")
            .set("Authorization", `Bearer ${token}`);

        expect(response.status).toBe(200);
        expect(response.body.rooms.length).toBe(1);
        expect(response.body.rooms[0].id).toBe("room1");
    });

    test("GET /my should return 401 if no token is provided", async () => {
        const response = await request(app).get("/my");
        expect(response.status).toBe(401);
    });
});
