// src/network/SocketIoClient.ts
import { io, Socket } from 'socket.io-client';
import type { INetworkClient, GameMetadata } from '@engine/shared/network/INetworkClient';

export class SocketIoClient<TState, TAction> implements INetworkClient<TState, TAction> {
    private socket: Socket;
    public gameId: string | null = null;

    public onStateUpdate: (state: TState) => void = () => { };
    public onError: (message: string) => void = () => { };
    public onMetadataUpdate: (metadata: GameMetadata) => void = () => { };
    public onChatMessage: (chat: { userId: string, message: string, channel: 'public' | 'private', recipientId?: string, timestamp: string }) => void = () => { };

    constructor(url: string, authToken?: string) {
        this.socket = io(url, {
            autoConnect: false,
            auth: { token: authToken } // JWTトークンをセット
        });

        // サーバーからのプッシュ通知イベント
        this.socket.on('state-update', (state: TState) => {
            this.onStateUpdate(state);
        });

        this.socket.on('error-message', (msg: string) => {
            this.onError(msg);
        });

        this.socket.on('metadata-update', (meta: GameMetadata) => {
            this.onMetadataUpdate(meta);
        });

        this.socket.on('chat-message', (chat: any) => {
            this.onChatMessage(chat);
        });

        this.socket.connect();
    }

    public async createGame(options?: any): Promise<string> {
        // まず接続を確立する
        if (!this.socket.connected) {
            await this.connect("");
        }

        const gameType = options?.type ?? 'othello-3d';
        const gameOptions = options?.gameOptions;

        return new Promise((resolve, reject) => {
            // サーバーに作成をリクエスト
            this.socket.emit('request-create-game', { type: gameType, options: gameOptions });

            // 1回だけ返信を待つ
            this.socket.once('game-created', (gameId: string) => {
                // 作成されたら自動的にその部屋に入る
                this.connect(gameId);
                resolve(gameId);
            });

            // タイムアウト処理（5秒待っても反応がなければ失敗）
            setTimeout(() => reject(new Error("Create game timeout")), 3000);
        });
    }

    public async connect(gameId: string): Promise<void> {
        return new Promise((resolve, reject) => {
            if (this.socket.connected) {
                if (gameId) {
                    this.gameId = gameId;
                    this.socket.emit('join-game', gameId);
                }
                resolve();
            } else {
                this.socket.once('connect', () => {
                    if (gameId) {
                        this.gameId = gameId;
                        this.socket.emit('join-game', gameId);
                    }
                    resolve();
                });
                this.socket.once('connect_error', (err) => {
                    reject(err);
                });
                this.socket.connect();
            }
        });
    }

    public disconnect(): void {
        this.socket.disconnect();
    }

    public sendAction(action: TAction): void {
        if (!this.gameId) return;
        // 汎用エンジンに合わせ、特定のゲームに依存しない汎用的なイベント名を使用
        this.socket.emit('dispatch-action', {
            gameId: this.gameId,
            action: action
        });
    }

    public sendChat(message: string, channel: 'public' | 'private', recipientId?: string): void {
        if (!this.gameId) return;
        this.socket.emit('send-chat', {
            gameId: this.gameId,
            message,
            channel,
            recipientId
        });
    }
}