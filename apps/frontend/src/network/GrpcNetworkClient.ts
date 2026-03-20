// src/network/GrpcNetworkClient.ts
// この実装には grpc-web と google-protobuf が必要です。
// また、game.proto からプロト生成された GameServiceClient および 各種Messageクラス をインポートする必要があります。

import type { INetworkClient, GameMetadata as SharedGameMetadata } from '@engine/shared/network/INetworkClient';

// モック的なインポート（実際には protoc で生成したコードを使用）
/*
import { GameServiceClient } from '../generated/game_grpc_web_pb';
import { CreateGameRequest, JoinGameRequest, DispatchActionRequest, GameAction as ProtoAction, ChatMessage as ProtoChat } from '../generated/game_pb';
*/

export class GrpcNetworkClient<TState, TAction> implements INetworkClient<TState, TAction> {
    private client: any; // 本来は GameServiceClient
    public gameId: string | null = null;
    private eventStream: any = null;

    public onStateUpdate: (state: TState) => void = () => { };
    public onError: (message: string) => void = () => { };
    public onMetadataUpdate?: (metadata: SharedGameMetadata) => void;
    public onChatMessage?: (chat: any) => void;

    constructor(baseUrl: string) {
        // gRPC-web クライアントの初期化
        // this.client = new GameServiceClient(baseUrl);
        console.log("GrpcNetworkClient initialized for:", baseUrl);
    }

    public async createGame(options?: any): Promise<string> {
        return new Promise((resolve, reject) => {
            /* 
            const req = new CreateGameRequest();
            req.setGameType(options?.type ?? 'speed');
            req.setOptionsJson(JSON.stringify(options?.gameOptions ?? {}));

            this.client.createGame(req, {}, (err: any, response: any) => {
                if (err) return reject(err);
                const gameId = response.getGameId();
                this.connect(gameId); // 接続も開始
                resolve(gameId);
            });
            */
            console.log("Mock: createGame called", options);
            resolve("mock-game-id-123");
        });
    }

    public async connect(gameId: string, options?: { asSpectator?: boolean }): Promise<void> {
        this.gameId = gameId;

        // イベントストリームの開始
        /*
        const req = new JoinGameRequest();
        req.setGameId(gameId);
        req.setAsSpectator(!!options?.asSpectator);

        this.eventStream = this.client.streamEvents(req, {});
        this.eventStream.on('data', (event: any) => {
            if (event.hasStateUpdate()) {
                const update = event.getStateUpdate();
                const state = JSON.parse(update.getStateJson());
                this.onStateUpdate(state);
                
                if (this.onMetadataUpdate && update.hasMetadata()) {
                    const meta = update.getMetadata();
                    this.onMetadataUpdate({
                        playerCount: meta.getPlayerCount(),
                        spectatorCount: meta.getSpectatorCount(),
                        activePlayers: meta.getActivePlayersList()
                    });
                }
            } else if (event.hasChatMessage()) {
                this.onChatMessage?.(JSON.parse(event.getChatMessage().getMessage()));
            } else if (event.hasErrorMessage()) {
                this.onError(event.getErrorMessage());
            }
        });

        this.eventStream.on('error', (err: any) => {
            this.onError(err.message);
        });
        */
        console.log("Mock: Starting gRPC stream for game", gameId);
        return Promise.resolve();
    }

    public disconnect(): void {
        if (this.eventStream) {
            this.eventStream.cancel();
            this.eventStream = null;
        }
        this.gameId = null;
    }

    public sendAction(action: TAction): void {
        if (!this.gameId) return;

        /*
        const req = new DispatchActionRequest();
        req.setGameId(this.gameId);
        
        const protoAction = new ProtoAction();
        protoAction.setType((action as any).type);
        protoAction.setPayloadJson(JSON.stringify(action));
        req.setAction(protoAction);

        this.client.dispatchAction(req, {}, (err: any) => {
            if (err) this.onError(err.message);
        });
        */
        console.log("Mock: Sending gRPC action", action);
    }
}
