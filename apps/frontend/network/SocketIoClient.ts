import { io, Socket } from "socket.io-client";
import type {
  INetworkClient,
  GameMetadata,
  ChatMessage,
  GameCreateOptions,
} from "@engine/shared/network/INetworkClient";
import { applyPatch } from "fast-json-patch";
import type { Operation } from "fast-json-patch";
import { calculateStateHash } from "@engine/shared";
import type { BaseGameState } from "@engine/shared";

export class SocketIoClient<TState extends BaseGameState, TAction> implements INetworkClient<
  TState,
  TAction
> {
  private socket: Socket;
  public gameId: string | null = null;
  private localState: TState | null = null;

  public onStateUpdate: (state: TState) => void = () => {};
  public onError: (message: string) => void = () => {};
  public onMetadataUpdate: (metadata: GameMetadata) => void = () => {};
  public onChatMessage: (chat: ChatMessage) => void = () => {};

  constructor(url: string, authToken?: string) {
    this.socket = io(url, {
      autoConnect: false,
      auth: { token: authToken }, // JWTトークンをセット
    });

    // サーバーからのプッシュ通知イベント
    this.socket.on("state-update", (state: TState) => {
      this.localState = state;
      this.onStateUpdate(state);
    });

    this.socket.on(
      "state-patch",
      (payload: {
        patch: Operation[];
        baseVersion: number;
        targetVersion: number;
        hash: string;
      }) => {
        if (!this.localState) {
          console.warn("[SocketIoClient] Received patch but no local state exists. Ignoring.");
          return;
        }

        const currentState = this.localState;
        if (currentState.version !== payload.baseVersion) {
          console.error(
            `[SocketIoClient] Version mismatch! local:${currentState.version}, base:${payload.baseVersion}. Requesting full sync.`,
          );
          this.socket.emit("request-full-state", { gameId: this.gameId });
          return;
        }

        // パッチを適用
        try {
          // localState を直接書き換える (fast-json-patch はインプレース更新も可能)
          const result = applyPatch(this.localState, payload.patch, false, false);
          const nextState = result.newDocument as TState;

          if (nextState) {
            nextState.version = payload.targetVersion;

            // ハッシュチェック
            const currentHash = calculateStateHash(nextState);
            if (currentHash !== payload.hash) {
              console.error(
                `[SocketIoClient] Hash mismatch after patch! target:${payload.hash}, local:${currentHash}. Requesting full sync.`,
              );
              this.socket.emit("request-full-state", { gameId: this.gameId });
              return;
            }

            this.localState = nextState;
            this.onStateUpdate(this.localState);
          }
        } catch (err) {
          console.error("[SocketIoClient] Failed to apply patch. Requesting full sync:", err);
          this.socket.emit("request-full-state", { gameId: this.gameId });
        }
      },
    );

    this.socket.on("error-message", (msg: string) => {
      this.onError(msg);
    });

    this.socket.on("metadata-update", (meta: GameMetadata) => {
      this.onMetadataUpdate(meta);
    });

    this.socket.on("chat-message", (chat: ChatMessage) => {
      this.onChatMessage(chat);
    });

    this.socket.connect();
  }

  public async createGame(options?: GameCreateOptions): Promise<string> {
    // まず接続を確立する
    if (!this.socket.connected) {
      await this.connect("");
    }

    const gameType = options?.type ?? "othello-3d";
    const gameOptions = options?.gameOptions ?? options?.options;

    return new Promise((resolve, reject) => {
      // サーバーに作成をリクエスト
      this.socket.emit("request-create-game", {
        type: gameType,
        options: gameOptions,
      });

      // 1回だけ返信を待つ
      this.socket.once("game-created", (gameId: string) => {
        // 作成されたら自動的にその部屋に入る
        this.connect(gameId);
        resolve(gameId);
      });

      // タイムアウト処理（3秒待っても反応がなければ失敗）
      setTimeout(() => reject(new Error("Create game timeout")), 3000);
    });
  }

  public async connect(gameId: string, options?: { asSpectator?: boolean }): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.socket.connected) {
        if (gameId) {
          this.gameId = gameId;
          this.socket.emit("join-game", gameId, options);
        }
        resolve();
      } else {
        this.socket.once("connect", () => {
          if (gameId) {
            this.gameId = gameId;
            this.socket.emit("join-game", gameId, options);
          }
          resolve();
        });
        this.socket.once("connect_error", (err: Error) => {
          reject(err);
        });
        this.socket.connect();
      }
    });
  }

  public disconnect(): void {
    this.socket.disconnect();
  }

  public leaveGame(gameId: string): void {
    this.socket.emit("leave-game", gameId);
  }

  public sendAction(action: TAction): void {
    if (!this.gameId) return;
    // 汎用エンジンに合わせ、特定のゲームに依存しない汎用的なイベント名を使用
    this.socket.emit("dispatch-action", {
      gameId: this.gameId,
      action: action,
    });
  }

  public sendChat(message: string, channel: "public" | "private", recipientId?: string): void {
    if (!this.gameId) return;
    this.socket.emit("send-chat", {
      gameId: this.gameId,
      message,
      channel,
      recipientId,
    });
  }
}
