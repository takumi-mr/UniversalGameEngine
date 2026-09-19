import { Server } from "socket.io";
import jwt from "jsonwebtoken";
import { JWT_SECRET, isClusterMode } from "@engine/backend/config";
import {
  sessions,
  createSession,
  withSession,
  ensureSession,
  dropLocalSession,
  onRemoteStateChanged,
  normalizeGameType,
} from "@engine/backend/store/sessionStore";
import { gameRegistry } from "@engine/shared/GameRegistry";
import { UniversalEngine } from "@engine/shared/UniversalEngine";
import {
  scheduleRoomCleanup,
  clearRoomCleanup,
  updatePresence,
} from "@engine/backend/socket/roomManager";
import { streamManager } from "@engine/backend/network/StreamManager";
import { setIoInstance, onClusterEvent } from "@engine/backend/network/io";
import { isBotType } from "@engine/backend/ai/botFactory";
import { sanitizeCreateOptions } from "@engine/backend/gameOptions";

/** 他インスタンスからのクラスタイベントを購読する（Redis アダプタ使用時のみ届く） */
const setupClusterHandlers = () => {
  onClusterEvent("uge:state-changed", ({ gameId, action }) => onRemoteStateChanged(gameId, action));
  onClusterEvent("uge:session-deleted", ({ gameId }) => dropLocalSession(gameId));
  onClusterEvent("uge:bot-turn", ({ gameId, playerId, stateTensor, legalActionIds, stateJson }) =>
    streamManager.notifyBotTurn(gameId, playerId, stateTensor, legalActionIds, stateJson),
  );
};

export const setupSocketIO = (io: Server) => {
  setIoInstance(io, { cluster: isClusterMode() });
  setupClusterHandlers();

  // Socket.IO ミドルウェア: JWTの検証を行う
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    console.log(
      `[Socket Middleware] Connection attempt. ID: ${socket.id}, Token present: ${!!token}`,
    );
    if (!token) {
      console.error(`[Socket Middleware] Authentication error: No token provided for ${socket.id}`);
      return next(new Error("Authentication error"));
    }

    try {
      const decoded = jwt.verify(token, JWT_SECRET) as { userId: string };
      socket.data.userId = decoded.userId;
      console.log(
        `[Socket Middleware] Authentication SUCCESS for ${socket.id}, User: ${decoded.userId}`,
      );
      next();
    } catch (err) {
      console.error(`[Socket Middleware] Invalid token for ${socket.id}: ${err}`);
      next(new Error("Invalid token"));
    }
  });

  io.on("connection", (socket) => {
    const userId = socket.data.userId;
    console.log(`User connected: ${socket.id} (User ID: ${userId})`);

    // 部屋の作成リクエスト
    socket.on("request-create-game", async ({ type, options: rawOptions }) => {
      if (typeof type !== "string") {
        socket.emit("error-message", "Game type is required");
        return;
      }
      const def = gameRegistry.getDefinition(type.toLowerCase());
      if (!def) {
        console.error(`Unknown game type: ${type}`);
        socket.emit("error-message", `Unknown game type: ${type}`);
        return;
      }

      try {
        console.log(`Creating game: ${type} for user ${userId}`);
        const gameId = Math.random().toString(36).substring(7);
        const normalizedType = normalizeGameType(type);
        // クライアントの options は許可リストを通す（serverSeed や initialScores 等は捨てる）
        const options = sanitizeCreateOptions(normalizedType, rawOptions);
        const engine = new UniversalEngine(def.ruleset, options);
        const { server } = createSession(gameId, engine, normalizedType);

        // プレイヤー構成に基づいてスロットを割り当てる
        const state = engine.getState();
        if (state.players) {
          const slotKeys = Object.keys(state.players);
          // playersConfig: スロットごとの種別配列 (例: ['human', 'random', 'minimax'])
          const playersConfig = options.playersConfig as string[] | undefined;

          const seatBot = (slotKey: string, aiType: string, idx: number) => {
            if (!isBotType(aiType)) return;
            const botId = `bot_${idx}_` + Math.random().toString(36).substring(7);
            // 着席はエンジンの組み込み JOIN（history に記録される）
            engine.dispatch({ type: "JOIN", playerId: botId, slot: slotKey });
            if (server.addBot({ playerId: botId, aiType, name: `${aiType} ${idx}` })) {
              console.log(`[AI] Spawned ${aiType} ${botId} in slot ${slotKey} for game ${gameId}`);
            }
          };

          if (playersConfig && playersConfig.length > 0) {
            // カスタム構成: 各スロットに個別のタイプを割り当てる
            for (let i = 0; i < Math.min(playersConfig.length, slotKeys.length); i++) {
              const slotType = playersConfig[i];
              if (slotType && slotType !== "human") seatBot(slotKeys[i] as string, slotType, i);
            }
          } else if (typeof options.addAi === "string") {
            // レガシー互換: 最初のスロットを人間用に残し、残りを同じAIで埋める
            for (let i = 1; i < slotKeys.length; i++) {
              seatBot(slotKeys[i] as string, options.addAi, i);
            }
          }

          // 全スロットが埋まっている（全員AIの場合等）なら即座に開始する
          const seated = Object.values(engine.getState().players || {}).filter(
            (p) => p !== null,
          ) as string[];
          if (seated.length >= slotKeys.length && seated.length >= def.minPlayers) {
            // START はエンジンの組み込みアクション。ルールセットが START を持てばその初期化（Speed, Mahjong 等）が走り、
            // 持たなければ status を PLAYING にして手番を設定する
            // サーバー発のアクションにも時刻を付ける（時刻駆動のルールセットが開始時刻を記録できるように）
            if (engine.dispatch({ type: "START", playerId: seated[0], timestamp: Date.now() })) {
              console.log(`[AI] All slots filled — game ${gameId} auto-started`);
            }
          }
        }

        // 他のインスタンスからも見えるように保存する（全員 AI なら配信をきっかけに AI が動き出す）
        await server.commit();

        // 作成した本人に ID を送り返す
        socket.emit("game-created", gameId);
        console.log(`Game ${gameId} created via WebSocket by ${userId}`);

        // 誰もいない状態で作成されるため、すぐにクリーンアップ対象にする（参加しなければ5分後に消える）
        await scheduleRoomCleanup(gameId);
      } catch (error) {
        console.error(`Failed to create game ${type}:`, error);
        socket.emit("error-message", `Failed to create game: ${(error as Error).message || error}`);
      }
    });

    // ルーム（ゲーム）への参加
    socket.on("join-game", async (gameId: string, options?: { asSpectator?: boolean }) => {
      const asSpectator = options?.asSpectator ?? false;
      await clearRoomCleanup(gameId);
      socket.join(gameId);

      // ★ ロックを取り、メモリになければストアから復元する（どのインスタンスでも同じ対局を扱える）
      const result = await withSession(gameId, async (session) => {
        const engine = session.server.engine;
        const state = engine.getState();

        // プレイヤーの自動割り当て（空いている席に座る）。
        // 着席・開始はエンジンの組み込み JOIN / START で行い、history に記録する（リプレイで再現可能にするため）
        if (state.players && !asSpectator) {
          const isAlreadyAssigned = Object.values(state.players).includes(userId);
          const joined = !isAlreadyAssigned && engine.dispatch({ type: "JOIN", playerId: userId });

          if (joined) {
            console.log(`User ${userId} joined game ${gameId}`);
            const current = engine.getState();
            const uniquePlayersCount = new Set(
              Object.values(current.players ?? {}).filter((p) => p !== null),
            ).size;
            const def = gameRegistry.getDefinition(session.type);

            if (current.status === "WAITING" && def && uniquePlayersCount >= def.minPlayers) {
              const firstPlayerId = Object.values(current.players ?? {}).find((p) => p !== null)!;
              if (
                engine.dispatch({
                  type: "START",
                  playerId: firstPlayerId,
                  timestamp: Date.now(),
                })
              ) {
                console.log(`Game ${gameId} started (by ${firstPlayerId})`);
              }
            }
            await session.server.commit();
          }
        }
        return session;
      });

      if (!result) {
        socket.emit("error-message", "Game session not found");
        return;
      }

      const state = result.server.engine.getState();
      const players = state.players
        ? (Object.values(state.players).filter(Boolean) as string[])
        : [];

      // 参加した瞬間に現在の状態を送信
      console.log(`User ${userId} (socket: ${socket.id}) joined room ${gameId}`);
      const targetId = players.includes(userId) ? userId : "SPECTATOR";
      socket.emit("state-update", result.server.engine.getMaskedState(targetId));

      if (players.length > 0) {
        // 割り当てがあった場合、全員に通知 (マスク対応)
        result.server.broadcastLocal();

        // プレイヤーとして割り当てられているならプレイヤー専用ルームにも入る
        if (players.includes(userId)) {
          socket.join(`${gameId}:players`);
          console.log(`User ${userId} joined players-only room for ${gameId}`);
        }
      }
      await updatePresence(gameId);
    });

    // ルームからの退出
    socket.on("leave-game", async (gameId: string) => {
      console.log(`User ${userId} requested to leave game ${gameId}`);
      await withSession(gameId, async (session) => {
        const state = session.server.engine.getState();
        if (!state.players) return;
        // プレイヤーとして割り当てられていた場合、スロットをクリアする
        let updated = false;
        for (const [key, val] of Object.entries(state.players)) {
          if (val === userId) {
            state.players[key] = null;
            updated = true;
            console.log(`Cleared slot "${key}" for user ${userId} in game ${gameId}`);
          }
        }
        if (updated) await session.server.commit();
      });
      socket.leave(gameId);
      socket.leave(`${gameId}:players`);
      await updatePresence(gameId);
    });

    // チャットメッセージの送信
    socket.on("send-chat", async ({ gameId, message, channel, recipientId }) => {
      if (!message || typeof message !== "string") return;
      const session = await ensureSession(gameId);
      if (!session) return;

      const chatPayload = {
        userId,
        message,
        channel: channel === "private" ? "private" : "public",
        recipientId, // 指定された宛先
        timestamp: new Date().toISOString(),
      };

      if (channel === "private") {
        const state = session.server.engine.getState();
        const players = state.players
          ? (Object.values(state.players).filter(Boolean) as string[])
          : [];
        if (!players.includes(userId)) {
          console.warn(
            `[Chat] User ${userId} attempted to send private chat but is not a player in ${gameId}`,
          );
          return;
        }

        if (recipientId && recipientId !== "all") {
          // 特定の個人への送信: 送信者と受信者にのみ送信する
          // （fetchSockets はアダプタ越しに他インスタンスのソケットも返す）
          const targetSockets = await io.in(gameId).fetchSockets();
          for (const s of targetSockets) {
            if (s.data.userId === recipientId || s.data.userId === userId) {
              s.emit("chat-message", chatPayload);
            }
          }
        } else {
          // プレイヤー全員に送信
          io.to(`${gameId}:players`).emit("chat-message", chatPayload);
        }
      } else {
        // 全体に送信
        io.to(gameId).emit("chat-message", chatPayload);
      }

      // 3. gRPCストリームへの通知
      streamManager.broadcast(gameId, {
        chatMessage: chatPayload,
      });

      console.log(
        `[Chat] ${userId} sent ${channel || "public"} message to ${gameId} (recipient: ${recipientId || "all"})`,
      );
    });

    // 着手アクションの受信
    socket.on("dispatch-action", async ({ gameId, action }) => {
      if (!action || typeof action !== "object" || typeof action.type !== "string") {
        socket.emit("error-message", "Invalid action");
        return;
      }
      const session = await ensureSession(gameId);
      if (!session) return;

      // 開始前に通すのはルールセット自身が扱う START / RESET だけ。
      // 組み込みの JOIN / START / TIMEOUT は dispatchAction では無効（着席は join-game で行う）
      const currentState = session.server.engine.getState();
      if (currentState.status !== "PLAYING" && action.type !== "RESET" && action.type !== "START") {
        console.warn(
          `[Blocked] Action ${action.type} for game ${gameId} blocked - status is ${currentState.status}`,
        );
        socket.emit("error-message", "Game is not in PLAYING status");
        return;
      }

      // dispatchAction はロック → 最新化 → dispatch → 保存 → 配信 までを行う
      try {
        const success = await session.server.dispatchAction(socket.data.userId, action);
        if (!success) {
          socket.emit("error-message", "Invalid move or not your turn!");
        }
      } catch (err) {
        // ロック待ちのタイムアウトやストア障害。クライアントには再試行を促す
        console.error(`[Socket] dispatch-action failed for game ${gameId}:`, err);
        socket.emit("error-message", "Failed to apply the action. Please retry.");
      }
    });

    // フルデータの再同期リクエスト
    socket.on("request-full-state", async ({ gameId }) => {
      const session = await ensureSession(gameId);
      if (session) {
        console.log(`[Socket] User ${userId} requested full state for game ${gameId}`);
        session.server.broadcastLocal(socket.id);
      }
    });

    socket.on("disconnecting", () => {
      // 切断直前に所属していた全ルームを取得
      const rooms = Array.from(socket.rooms);

      socket.on("disconnect", () => {
        // 完全に切断（ルームから退出）した後に、各ルームの人数を更新する
        for (const room of rooms) {
          const session = sessions.get(room);
          if (session) {
            session.server.handleDisconnect(socket.id);
            updatePresence(room).catch((err) =>
              console.error(`[Presence] Failed to update presence for ${room}:`, err),
            );
          }
        }
      });
      console.log(`User disconnecting: ${socket.id} (User ID: ${userId})`);
    });

    socket.on("disconnect", () => {
      console.log(`User disconnected: ${socket.id} (User ID: ${userId})`);
    });
  });
};
