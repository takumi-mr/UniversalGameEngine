// apps/backend/server.ts
import express from "express";
import cors from "cors";
import { createServer } from "http";
import { Server } from "socket.io";

import authRoutes from "./routes/auth";
import roomsRoutes from "./routes/rooms";
import gameRoutes from "./routes/game";
import replaysRoutes from "./routes/replays";
import { setupSocketIO } from "./socket";
import { startGrpcServer } from "./grpc-server";

process.on("uncaughtException", (err) => {
  console.error("[UNCAUGHT EXCEPTION]", err);
});
process.on("unhandledRejection", (reason, _promise) => {
  console.error("[UNHANDLED REJECTION]", reason);
});

const app = express();
app.use(cors());
app.use(express.json());

// --- HTTP Endpoints ---
app.use("/", authRoutes);
app.use("/rooms", roomsRoutes);
app.use("/game", gameRoutes);
app.use("/replays", replaysRoutes);

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: "*" }, // 開発用
});

// Setup Socket.IO
setupSocketIO(io);

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`🚀 Realtime Engine Platform running on port ${PORT}`);
});

const GRPC_PORT = process.env.GRPC_PORT || 50051;
startGrpcServer(GRPC_PORT);
