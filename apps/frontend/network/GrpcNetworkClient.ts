// src/network/GrpcNetworkClient.ts
import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import path from "path";
import type {
  INetworkClient,
  GameCreateOptions,
  GameMetadata as SharedGameMetadata,
  ChatMessage as SharedChatMessage,
} from "@engine/shared/network/INetworkClient";
import type { BaseGameAction, BaseGameState } from "@engine/shared";
import type { ProtoGrpcType } from "@engine/shared/network/generated/game";
import type { GameServiceClient } from "@engine/shared/network/generated/universal_game_engine/GameService";
import type { GameEvent__Output } from "@engine/shared/network/generated/universal_game_engine/GameEvent";
import type { CreateGameResponse__Output } from "@engine/shared/network/generated/universal_game_engine/CreateGameResponse";
import type { CommonResponse__Output } from "@engine/shared/network/generated/universal_game_engine/CommonResponse";

// ESM環境で __dirname を使えるようにする
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ※ Electron実行時のパス解決に注意してください（__dirnameの扱いやasar化の影響など）
const PROTO_PATH = path.resolve(__dirname, "../../../packages/shared/network/game.proto");

const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});

const protoDescriptor = grpc.loadPackageDefinition(packageDefinition) as unknown as ProtoGrpcType;
const GameService = protoDescriptor.universal_game_engine.GameService;

export class GrpcNetworkClient<
  TState extends BaseGameState,
  TAction extends BaseGameAction,
> implements INetworkClient<TState, TAction> {
  private client: GameServiceClient;
  public gameId: string | null = null;
  public playerId: string | null = null;
  private eventStream: grpc.ClientReadableStream<GameEvent__Output> | null = null;
  private token: string;

  public onStateUpdate: (state: TState) => void = () => {};
  public onError: (message: string) => void = () => {};
  public onMetadataUpdate?: (metadata: SharedGameMetadata) => void;
  public onChatMessage?: (chat: SharedChatMessage) => void;

  constructor(baseUrl: string = "localhost:50051", token: string = "") {
    // Node.js用のネイティブgRPCクライアントを初期化（開発時はInsecure）
    this.client = new GameService(baseUrl, grpc.credentials.createInsecure());
    this.token = token;
    console.log("GrpcNetworkClient (Node.js) initialized for:", baseUrl);
  }

  private buildGrpcMetadata(): grpc.Metadata {
    const meta = new grpc.Metadata();
    if (this.token) {
      meta.add("authorization", `Bearer ${this.token}`);
    }
    return meta;
  }

  public async createGame(options?: GameCreateOptions): Promise<string> {
    return new Promise((resolve, reject) => {
      // @grpc/grpc-js ではプレーンなオブジェクトをそのまま渡せる！
      const req = {
        gameType: options?.type ?? "tictactoe",
        optionsJson: JSON.stringify(options?.gameOptions ?? {}),
      };

      this.client.CreateGame(
        req,
        this.buildGrpcMetadata(),
        (err: grpc.ServiceError | null, response?: CreateGameResponse__Output) => {
          if (err || !response) return reject(err ?? new Error("Empty CreateGame response"));
          resolve(response.gameId);
        },
      );
    });
  }

  public async connect(gameId: string, options?: { asSpectator?: boolean }): Promise<void> {
    this.gameId = gameId;

    const req = {
      gameId: gameId,
      asSpectator: !!options?.asSpectator,
      userToken: this.token,
    };

    // サーバーサイドストリーミングの開始
    this.eventStream = this.client.StreamEvents(req, this.buildGrpcMetadata());

    this.eventStream.on("data", (event: GameEvent__Output) => {
      if (event.joined) {
        this.playerId = event.joined.assignedPlayerId;
        console.log("Joined game as player:", this.playerId);
      } else if (event.stateUpdate) {
        const update = event.stateUpdate;
        const state = JSON.parse(update.stateJson);
        this.onStateUpdate(state);

        if (this.onMetadataUpdate && update.metadata) {
          this.onMetadataUpdate({
            playerCount: update.metadata.playerCount,
            spectatorCount: update.metadata.spectatorCount,
            activePlayers: update.metadata.activePlayers || [],
          });
        }
      } else if (event.chatMessage) {
        const chat = event.chatMessage;
        this.onChatMessage?.({
          userId: chat.userId,
          message: chat.message,
          channel: chat.channel === "private" ? "private" : "public",
          recipientId: chat.recipientId || undefined,
          timestamp: chat.timestamp,
        });
      } else if (event.errorMessage) {
        this.onError(event.errorMessage);
      }
    });

    this.eventStream.on("error", (err: Partial<grpc.ServiceError>) => {
      // gRPCの正常終了(CANCELLED)はエラーとして扱わない
      if (err.code === grpc.status.CANCELLED) return;

      console.error("gRPC Stream Error:", err);
      this.onError(err.details || err.message || "Stream connection error");
      this.disconnect();
    });

    this.eventStream.on("end", () => {
      console.log("gRPC Stream ended by server");
      this.disconnect();
    });

    return Promise.resolve();
  }

  public disconnect(): void {
    if (this.eventStream) {
      this.eventStream.cancel();
      this.eventStream = null;
    }
    this.gameId = null;
    this.playerId = null;
  }

  public sendAction(action: TAction): void {
    if (!this.gameId) return;

    const req = {
      gameId: this.gameId,
      action: {
        type: action.type,
        payloadJson: JSON.stringify(action),
      },
    };

    this.client.DispatchAction(
      req,
      this.buildGrpcMetadata(),
      (err: grpc.ServiceError | null, response?: CommonResponse__Output) => {
        if (err) {
          this.onError(err.details || err.message);
          return;
        }
        if (response && !response.success) {
          this.onError(response.message);
        }
      },
    );
  }

  public sendChat(message: string, channel: "public" | "private", recipientId?: string): void {
    if (!this.gameId) return;

    const req = {
      userId: this.playerId || "anonymous",
      message: message,
      channel: channel,
      recipientId: recipientId || "",
      timestamp: new Date().toISOString(),
      gameId: this.gameId,
    };

    this.client.SendChat(
      req,
      this.buildGrpcMetadata(),
      (err: grpc.ServiceError | null, response?: CommonResponse__Output) => {
        if (err) {
          this.onError(err.details || err.message);
          return;
        }
        if (response && !response.success) {
          this.onError(response.message);
        }
      },
    );
  }
}
