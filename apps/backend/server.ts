// apps/backend/server.ts
import express from "express";
import cors from "cors";
import { createServer } from "http";
import { Server } from "socket.io";
import Redis from "ioredis";
import { createAdapter } from "@socket.io/redis-adapter";

import { isClusterMode, REDIS_URL } from "@engine/backend/config";
import authRoutes from "@engine/backend/routes/auth";
import roomsRoutes from "@engine/backend/routes/rooms";
import gameRoutes from "@engine/backend/routes/game";
import replaysRoutes from "@engine/backend/routes/replays";
import { setupSocketIO } from "@engine/backend/socket";
import { startCleanupSweeper } from "@engine/backend/socket/roomManager";
import { startDeadlineSweeper } from "@engine/backend/store/deadlineSweeper";
import { startGrpcServer } from "@engine/backend/grpc-server";
import { INSTANCE_ID } from "@engine/backend/network/io";

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

// 複数インスタンス構成: Socket.io のルーム / ブロードキャスト / serverSideEmit を Redis の pub/sub で共有する。
// これにより、どのインスタンスに接続しているクライアントにも io.to(room).emit が届き、
// fetchSockets() はクラスタ全体のソケットを返す。
const adapterClients: Redis[] = [];
if (isClusterMode()) {
  const pubClient = new Redis(REDIS_URL);
  const subClient = pubClient.duplicate();
  adapterClients.push(pubClient, subClient);
  for (const client of adapterClients) {
    client.on("error", (err) => console.error("[Socket.IO Redis adapter]", err));
  }
  io.adapter(createAdapter(pubClient, subClient));
  console.log(`🔗 Socket.IO Redis adapter enabled (instance ${INSTANCE_ID})`);
}

// Setup Socket.IO
setupSocketIO(io);

// 空室クリーンアップ（予約はストアにあるので、どのインスタンスが拾ってもよい）
const stopCleanupSweeper = startCleanupSweeper();
// 手番の締切（予約はストアにあるので、どのインスタンスが拾ってもよい）
const stopDeadlineSweeper = startDeadlineSweeper();

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`🚀 Realtime Engine Platform running on port ${PORT}`);
});

const GRPC_PORT = process.env.GRPC_PORT || 50051;
const grpcServer = startGrpcServer(GRPC_PORT).catch((err) => {
  console.error("[gRPC] startup failed:", err);
  return null;
});

// --- Graceful shutdown ---
// スケールイン時に接続を切ってから終了する。状態はすべてストアにあるので、
// 切断されたクライアントは別のインスタンスへ再接続すれば続きから遊べる。
let shuttingDown = false;
const shutdown = async (signal: string) => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[Shutdown] ${signal} received — closing connections`);
  stopCleanupSweeper();
  stopDeadlineSweeper();
  try {
    (await grpcServer)?.server.forceShutdown();
    await io.close();
    for (const client of adapterClients) await client.quit().catch(() => {});
  } catch (err) {
    console.error("[Shutdown] Error while closing:", err);
  }
  process.exit(0);
};
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
