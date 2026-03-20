import { expect, test, describe } from "bun:test";
import request from "supertest";
import express from "express";
import authRoutes from "./auth";

const app = express();
app.use(express.json());
app.use("/", authRoutes);

describe("Auth Routes", () => {
    test("POST /login should return a token for a valid username", async () => {
        const response = await request(app)
            .post("/login")
            .send({ username: "testuser", password: "any" });
        
        expect(response.status).toBe(200);
        expect(response.body.token).toBeDefined();
        expect(response.body.userId).toBe("testuser");
    });

    test("POST /login should return 400 if username is missing", async () => {
        const response = await request(app)
            .post("/login")
            .send({ password: "any" });
        
        expect(response.status).toBe(400);
        expect(response.body.error).toBe("Username is required");
    });
});
