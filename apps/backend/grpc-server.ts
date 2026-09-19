// apps/backend/grpc-server.ts
import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import path from "path";
import jwt from "jsonwebtoken";
import { JWT_SECRET, isRlMode } from "@engine/backend/config";
import {
  createSession,
  ensureSession,
  withSession,
  normalizeGameType,
} from "@engine/backend/store/sessionStore";
import { gameRegistry } from "@engine/shared/GameRegistry";
import { aiTensorRegistry } from "@engine/shared/ai/AITensorAdapterRegistry";
// 組み込みテンソルアダプタ（othello 等）を aiTensorRegistry に登録する
import "@engine/shared/ai/TensorAdapter";
import { UniversalEngine } from "@engine/shared/UniversalEngine";
import type { BaseGameAction, BaseGameState } from "@engine/shared/GameRules";
import type { AnyRuleset } from "@engine/shared/rules/subGameResolver";
import { GrpcBotPlayer } from "@engine/shared/ai/AIPlayer/GrpcBotPlayer";
import { encodeBotTurn } from "@engine/backend/ai/botFactory";
import { sanitizeCreateOptions } from "@engine/backend/gameOptions";
import type { ProtoGrpcType } from "@engine/shared/network/generated/game";
import type { GameServiceHandlers } from "@engine/shared/network/generated/universal_game_engine/GameService";
import type { CreateGameRequest__Output } from "@engine/shared/network/generated/universal_game_engine/CreateGameRequest";
import type { SimulateRequest } from "@engine/shared/network/generated/universal_game_engine/SimulateRequest";
import type { SimulateResponse } from "@engine/shared/network/generated/universal_game_engine/SimulateResponse";
import {
  getIoInstance,
  scheduleRoomCleanup,
  clearRoomCleanup,
} from "@engine/backend/socket/roomManager";
import { streamManager } from "@engine/backend/network/StreamManager";

const PROTO_PATH = path.resolve(__dirname, "../../packages/shared/network/game.proto");

const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
  keepCase: false,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});

const protoDescriptor = grpc.loadPackageDefinition(packageDefinition) as unknown as ProtoGrpcType;
const universal_game_engine = protoDescriptor.universal_game_engine;

/** 例外からクライアントへ返すメッセージを取り出す */
const errorMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** 認証はメタデータだけを見る（Unary / ストリームのどちらの call でも可） */
const authenticate = (call: { metadata: grpc.Metadata }): string | null => {
  const metadata = call.metadata.get("authorization");
  if (metadata.length === 0) return "anonymous"; // モック環境や開発用
  const authHeader = metadata[0] as string;
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : authHeader;
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { userId: string };
    return decoded.userId;
  } catch {
    return null;
  }
};

// Simulate 用のエンジンをゲームタイプごとに使い回す。
// 生成コストが 1 回あたり約 25µs と大きく、ハンドラは同期実行なので共有しても安全。
// ハッシュ計算は探索には不要なので autoHash を切っておく。
type SimulationEngine = UniversalEngine<BaseGameState, BaseGameAction>;
const simulationEngines = new Map<string, SimulationEngine>();
const getSimulationEngine = (gameType: string, ruleset: AnyRuleset): SimulationEngine => {
  const cached = simulationEngines.get(gameType);
  if (cached) return cached;
  const engine: SimulationEngine = new UniversalEngine<BaseGameState, BaseGameAction>(ruleset, {
    autoHash: false,
  });
  simulationEngines.set(gameType, engine);
  return engine;
};

/**
 * 任意の局面に 1 手適用する（木探索用・セッション不要）。
 * 使い捨ての UniversalEngine に局面を載せて dispatch するため、RNG や終局処理はエンジンと同じ挙動になる。
 * 失敗は例外ではなく response.error で返す（BatchSimulate で個別に失敗を伝えるため）。
 */
const simulateOnce = (req: SimulateRequest): SimulateResponse => {
  const gameType = (req.gameType ?? "").toLowerCase().replace(/-/g, "_");
  const playerId = req.playerId ?? "";
  const actionId = req.actionId ?? 0;
  const fail = (error: string): SimulateResponse => ({
    stateJson: "",
    stateTensor: [],
    legalActionIds: [],
    reward: 0,
    isFinished: false,
    activePlayers: [],
    error,
  });

  const def = gameRegistry.getDefinition(gameType);
  if (!def) return fail(`Unknown game type: ${req.gameType}`);
  const adapter = aiTensorRegistry.getAdapter(gameType);
  if (!adapter) return fail("AI Tensor Adapter not found for this game type");
  if (!req.stateJson) return fail("state_json is required");

  let state: BaseGameState;
  try {
    state = JSON.parse(req.stateJson);
  } catch {
    return fail("state_json is not valid JSON");
  }

  const engine = getSimulationEngine(gameType, def.ruleset);
  engine.loadState(state);

  let action: BaseGameAction;
  try {
    action = adapter.decodeAction(engine.getState(), actionId, playerId);
  } catch (err) {
    return fail(errorMessage(err));
  }
  action.playerId = playerId;
  if (!engine.dispatch(action)) return fail("Invalid action or not your turn");

  const nextState = engine.getState();
  const winResult = def.ruleset.checkWinCondition(nextState);
  const isFinished = winResult.isFinished;
  const activePlayers = nextState.activePlayers || [];

  let reward = 0;
  if (isFinished) {
    if (winResult.winnerIds?.includes(playerId)) reward = 1.0;
    else if (winResult.winnerIds && winResult.winnerIds.length > 0) reward = -1.0;
    else reward = 0.5;
    // 終局時はエンジンがハッシュ履歴に追記する。使い回しで無限に増えないよう切り詰める
    engine.takeSnapshot();
  }

  const observerId = !isFinished && activePlayers.length > 0 ? activePlayers[0] : playerId;
  return {
    stateJson: JSON.stringify(nextState),
    stateTensor: adapter.encodeState(nextState, observerId),
    legalActionIds: isFinished ? [] : adapter.encodeLegalActions(nextState, observerId),
    reward,
    isFinished,
    activePlayers,
    error: "",
  };
};

/** RL 専用 RPC のガード。RL_MODE でなければ PERMISSION_DENIED を返し、ハンドラ本体は実行しない */
const requireRlMode = (
  callback: (err: Partial<grpc.StatusObject> & { message?: string }) => void,
): boolean => {
  if (isRlMode()) return true;
  callback({
    code: grpc.status.PERMISSION_DENIED,
    message: "This RPC is only available when the server runs with RL_MODE=true",
  });
  return false;
};

const gameServiceHandlers: GameServiceHandlers = {
  CreateGame: async (call, callback) => {
    const userId = authenticate(call);
    if (!userId)
      return callback({
        code: grpc.status.UNAUTHENTICATED,
        message: "Invalid token",
      });

    // gameType と game_type、どちらの形式でリクエストが来ても受け取れるようにする
    const req = call.request as CreateGameRequest__Output & {
      game_type?: string;
      options_json?: string;
    };
    const rawGameType = req.gameType || req.game_type;
    const rawOptionsJson = req.optionsJson || req.options_json;

    // もしgameTypeが指定されていなかった場合のエラーハンドリング
    if (!rawGameType) {
      return callback({
        code: grpc.status.INVALID_ARGUMENT,
        message: "game_type is required",
      });
    }

    const def = gameRegistry.getDefinition(rawGameType.toLowerCase());

    if (!def)
      return callback({
        code: grpc.status.NOT_FOUND,
        message: `Unknown game type: ${rawGameType}`,
      });

    try {
      const gameId = Math.random().toString(36).substring(7);
      const gameType = normalizeGameType(rawGameType);
      // クライアントの options は許可リストを通す（serverSeed や initialScores 等は捨てる）
      const options = sanitizeCreateOptions(gameType, JSON.parse(rawOptionsJson || "{}"));
      const engine = new UniversalEngine(def.ruleset, options);
      const { server } = createSession(gameId, engine, gameType);
      // 他のインスタンスからも見えるように保存する
      await server.commit();

      await scheduleRoomCleanup(gameId);
      callback(null, { gameId: gameId });
    } catch (err) {
      callback({ code: grpc.status.INTERNAL, message: errorMessage(err) });
    }
  },

  DispatchAction: async (call, callback) => {
    const userId = authenticate(call);
    if (!userId)
      return callback({
        code: grpc.status.UNAUTHENTICATED,
        message: "Invalid token",
      });

    const { gameId, action } = call.request;
    const session = await ensureSession(gameId);
    if (!session)
      return callback({
        code: grpc.status.NOT_FOUND,
        message: "Game session not found",
      });

    try {
      const payload = action?.payloadJson ? JSON.parse(action.payloadJson) : {};
      const success = await session.server.dispatchAction(userId, {
        ...payload,
        type: action?.type,
      });
      if (success) {
        callback(null, { success: true, message: "Action dispatched" });
      } else {
        callback(null, {
          success: false,
          message: "Invalid action or not your turn",
        });
      }
    } catch (err) {
      callback({ code: grpc.status.INTERNAL, message: errorMessage(err) });
    }
  },

  SendChat: (call, callback) => {
    const userId = authenticate(call);
    if (!userId)
      return callback({
        code: grpc.status.UNAUTHENTICATED,
        message: "Invalid token",
      });

    const { gameId, message, channel, recipientId } = call.request;
    const chatPayload = {
      userId: userId,
      message: message,
      channel: channel,
      recipientId: recipientId,
      timestamp: new Date().toISOString(),
    };

    // 1. gRPCストリームへの通知
    streamManager.broadcast(gameId, {
      chatMessage: chatPayload,
    });

    // 2. Socket.IOへの通知
    try {
      const io = getIoInstance();
      if (channel === "private") {
        io.to(`${gameId}:players`).emit("chat-message", chatPayload);
      } else {
        io.to(gameId).emit("chat-message", chatPayload);
      }
    } catch (err) {
      console.error("[gRPC] Failed to notify Socket.io for chat:", err);
    }

    callback(null, { success: true, message: "Chat sent" });
  },

  StreamEvents: async (call) => {
    const userId = authenticate(call);
    if (!userId) {
      call.destroy(
        Object.assign(new Error("Invalid token"), { code: grpc.status.UNAUTHENTICATED }),
      );
      return;
    }

    const { gameId } = call.request;
    streamManager.addStream(gameId, userId, call);

    // 初回の状態を送信（別インスタンスで作られた対局でもストアから復元できる）
    const session = await ensureSession(gameId);
    if (session) {
      const state = session.server.engine.getState();
      const players = state.players
        ? (Object.values(state.players).filter(Boolean) as string[])
        : [];
      call.write({
        joined: {
          assignedPlayerId: userId,
          gameId: gameId,
        },
      });
      call.write({
        stateUpdate: {
          stateJson: JSON.stringify(session.server.engine.getMaskedState(userId)),
          metadata: {
            playerCount: players.length,
            activePlayers: players,
          },
        },
      });
    }

    call.on("cancelled", () => {
      streamManager.removeStream(gameId, call);
    });
  },

  Reset: async (call, callback) => {
    if (!requireRlMode(callback)) return;
    const { gameId, playerIds } = call.request;

    // ロックの中で初期化 → 保存する（Step と同じく、どのインスタンスでも同じ結果になる）
    const handled = await withSession(gameId, async (session) => {
      const def = gameRegistry.getDefinition(session.type);
      const adapter = aiTensorRegistry.getAdapter(session.type);
      if (!def)
        return callback({
          code: grpc.status.INTERNAL,
          message: "Ruleset not found",
        });
      if (!adapter)
        return callback({
          code: grpc.status.UNIMPLEMENTED,
          message: "AI Tensor Adapter not found for this game type",
        });

      // 1. エンジンの状態を初期状態に戻す
      const engine = session.server.engine;
      engine.loadState(def.ruleset.getInitialState(engine.options));
      const state = engine.getState();

      // 2. 全席にプレイヤーを着席させ、即座に Step 可能な PLAYING 状態にする
      //    （Socket.io の join-game を経由しない RL クライアント向け）
      //    着席・開始はエンジンの組み込み JOIN / START で行う
      if (state.players) {
        const slotKeys = Object.keys(state.players);
        const seated = slotKeys.map((_, i) => playerIds?.[i] || `player_${i + 1}`);
        slotKeys.forEach((slotKey, i) => {
          engine.dispatch({ type: "JOIN", playerId: seated[i], slot: slotKey });
        });
        if (engine.getState().status === "WAITING") {
          engine.dispatch({ type: "START", playerId: seated[0], timestamp: Date.now() });
        }
      }
      await session.server.commit();
      const started = engine.getState();

      // 3. 学習ループ中に「空室」として掃除されないよう、予約を張り直す
      await clearRoomCleanup(gameId);
      await scheduleRoomCleanup(gameId);

      const activePlayers = started.activePlayers || [];

      // 4. 状態をAI用テンソル（数値配列）に変換
      const perspectivePlayerId = activePlayers.length > 0 ? activePlayers[0] : "";

      const stateTensor = adapter.encodeState(started, perspectivePlayerId);
      const legalActionIds =
        activePlayers.length > 0 ? adapter.encodeLegalActions(started, perspectivePlayerId) : [];

      callback(null, {
        initialStateTensor: stateTensor,
        initialLegalActionIds: legalActionIds,
        activePlayers: activePlayers,
        stateJson: JSON.stringify(started),
      });
      return true;
    }).catch((err: unknown) => {
      callback({ code: grpc.status.INTERNAL, message: errorMessage(err) });
      return true;
    });

    if (handled === null) {
      callback({
        code: grpc.status.NOT_FOUND,
        message: "Game session not found",
      });
    }
  },

  Step: async (call, callback) => {
    if (!requireRlMode(callback)) return;
    const { gameId, playerId, actionId } = call.request;
    const session = await ensureSession(gameId);
    if (!session)
      return callback({
        code: grpc.status.NOT_FOUND,
        message: "Game session not found",
      });

    try {
      const def = gameRegistry.getDefinition(session.type);
      const adapter = aiTensorRegistry.getAdapter(session.type);
      if (!def)
        return callback({
          code: grpc.status.INTERNAL,
          message: "Ruleset not found",
        });
      if (!adapter)
        return callback({
          code: grpc.status.UNIMPLEMENTED,
          message: "AI Tensor Adapter not found for this game type",
        });

      // 別インスタンスが進めた局面に対して decode するため、先にストアと同期する
      await session.server.refreshFromStore();
      const state = session.server.engine.getState();

      // 1. 行動インデックス(actionId)を実際のGameActionオブジェクトに復元する
      const action = adapter.decodeAction(state, actionId, playerId);

      // 2. アクションの適用（ロック → dispatch → 保存 → 配信）
      const success = await session.server.dispatchAction(playerId, action);
      if (!success) {
        return callback({
          code: grpc.status.INVALID_ARGUMENT,
          message: "Invalid action or not your turn",
        });
      }

      // 3. 次の状態と勝敗の確認
      const nextState = session.server.engine.getState();
      const winResult = def.ruleset.checkWinCondition(nextState);
      const isFinished = winResult.isFinished;

      // 4. 報酬の計算（例: 勝ち=1, 負け=-1, 引き分け=0.5）
      let reward = 0;
      if (isFinished) {
        if (winResult.winnerIds?.includes(playerId)) {
          reward = 1.0;
        } else if (winResult.winnerIds && winResult.winnerIds.length > 0) {
          reward = -1.0;
        } else {
          reward = 0.5; // 引き分け
        }
      }

      const activePlayers = nextState.activePlayers || [];

      // 5. 次の状態のテンソルと合法手リストを取得
      //    自己対戦ループでは 1 クライアントが全員を操作するため、
      //    「次に行動するプレイヤー」の視点で観測を返す（終局時は手を指した本人の視点）
      const observerId = !isFinished && activePlayers.length > 0 ? activePlayers[0] : playerId;
      const stateTensor = adapter.encodeState(nextState, observerId);
      const legalActionIds = isFinished ? [] : adapter.encodeLegalActions(nextState, observerId);

      callback(null, {
        nextStateTensor: stateTensor,
        legalActionIds: legalActionIds,
        reward: reward,
        isFinished: isFinished,
        activePlayers: activePlayers,
        stateJson: JSON.stringify(nextState),
      });
    } catch (err) {
      callback({ code: grpc.status.INTERNAL, message: errorMessage(err) });
    }
  },

  Simulate: (call, callback) => {
    if (!requireRlMode(callback)) return;
    try {
      callback(null, simulateOnce(call.request));
    } catch (err) {
      callback({ code: grpc.status.INTERNAL, message: errorMessage(err) });
    }
  },

  BatchSimulate: (call, callback) => {
    if (!requireRlMode(callback)) return;
    try {
      const items = (call.request.items ?? []).map((req) => simulateOnce(req));
      callback(null, { items });
    } catch (err) {
      callback({ code: grpc.status.INTERNAL, message: errorMessage(err) });
    }
  },

  WaitForTurn: async (call) => {
    const { gameId, playerId } = call.request;
    streamManager.addBotStream(gameId, playerId, call);

    call.on("cancelled", () => {
      streamManager.removeBotStream(gameId, playerId);
    });

    // 既にボットの手番になっていれば（ボットが後から接続した / 再接続した）、その手番を改めて送る。
    // GrpcBotPlayer は手番が来た時点で 1 度しか通知しないので、これが無いと対局が止まったままになる
    try {
      const session = await ensureSession(gameId);
      if (!session) return;
      const state = session.server.engine.getState();
      if (state.status !== "PLAYING" || !state.activePlayers?.includes(playerId)) return;
      const turn = encodeBotTurn(session.type, state, playerId);
      if (turn && turn.legalActionIds.length > 0) {
        streamManager.notifyBotTurn(
          gameId,
          playerId,
          turn.stateTensor,
          turn.legalActionIds,
          turn.stateJson,
        );
      }
    } catch (err) {
      console.error(`[gRPC] WaitForTurn: failed to resend the current turn for ${playerId}:`, err);
    }
  },

  SubmitTurn: async (call, callback) => {
    const { gameId, playerId, actionId } = call.request;
    const session = await ensureSession(gameId);
    if (!session)
      return callback({
        code: grpc.status.NOT_FOUND,
        message: "Game session not found",
      });

    try {
      const def = gameRegistry.getDefinition(session.type);
      const adapter = aiTensorRegistry.getAdapter(session.type);
      if (!def || !adapter)
        return callback({
          code: grpc.status.INTERNAL,
          message: "Ruleset or AI Tensor Adapter not found",
        });

      const aiPlayer = session.server.aiPlayers.get(playerId);
      if (!(aiPlayer instanceof GrpcBotPlayer)) {
        return callback({
          code: grpc.status.INVALID_ARGUMENT,
          message: "Player is not a GrpcBotPlayer or has no submitMove method",
        });
      }

      const state = session.server.engine.getState();
      const action = adapter.decodeAction(state, actionId, playerId);

      const success = aiPlayer.submitMove(action);
      if (success) {
        callback(null, { success: true, message: "Bot Move Submitted" });
      } else {
        callback(null, {
          success: false,
          message: "Bot is not waiting for a move",
        });
      }
    } catch (err) {
      callback({ code: grpc.status.INTERNAL, message: errorMessage(err) });
    }
  },
};

export const startGrpcServer = (
  port: number | string,
): Promise<{ server: grpc.Server; port: number }> => {
  const server = new grpc.Server();
  server.addService(universal_game_engine.GameService.service, gameServiceHandlers);
  return new Promise((resolve, reject) => {
    server.bindAsync(
      `0.0.0.0:${port}`,
      grpc.ServerCredentials.createInsecure(),
      (err, boundPort) => {
        if (err) {
          console.error(`[gRPC] Failed to bind: ${err.message}`);
          return reject(err);
        }
        console.log(`🚀 gRPC Server running on port ${boundPort}`);
        resolve({ server, port: boundPort });
      },
    );
  });
};
