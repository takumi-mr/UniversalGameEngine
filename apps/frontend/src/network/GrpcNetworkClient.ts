// src/network/GrpcNetworkClient.ts
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import path from 'path';
import type { INetworkClient, GameMetadata as SharedGameMetadata } from '@engine/shared/network/INetworkClient';
import type { BaseGameAction, BaseGameState } from '@engine/shared';

// ※ Electron実行時のパス解決に注意してください（__dirnameの扱いやasar化の影響など）
const PROTO_PATH = path.resolve(__dirname, '../../packages/shared/network/game.proto');

const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
});

const protoDescriptor = grpc.loadPackageDefinition(packageDefinition) as any;
const GameService = protoDescriptor.universal_game_engine.GameService;

export class GrpcNetworkClient<TState extends BaseGameState, TAction extends BaseGameAction> implements INetworkClient<TState, TAction> {
    private client: any; // GameServiceClient
    public gameId: string | null = null;
    public playerId: string | null = null;
    private eventStream: grpc.ClientReadableStream<any> | null = null;
    private token: string;

    public onStateUpdate: (state: TState) => void = () => { };
    public onError: (message: string) => void = () => { };
    public onMetadataUpdate?: (metadata: SharedGameMetadata) => void;
    public onChatMessage?: (chat: any) => void;

    constructor(baseUrl: string = 'localhost:50051', token: string = '') {
        // Node.js用のネイティブgRPCクライアントを初期化（開発時はInsecure）
        this.client = new GameService(baseUrl, grpc.credentials.createInsecure());
        this.token = token;
        console.log("GrpcNetworkClient (Node.js) initialized for:", baseUrl);
    }

    private buildGrpcMetadata(): grpc.Metadata {
        const meta = new grpc.Metadata();
        if (this.token) {
            meta.add('authorization', `Bearer ${this.token}`);
        }
        return meta;
    }

    public async createGame(options?: any): Promise<string> {
        return new Promise((resolve, reject) => {
            // @grpc/grpc-js ではプレーンなオブジェクトをそのまま渡せる！
            const req = {
                gameType: options?.type ?? 'tictactoe',
                optionsJson: JSON.stringify(options?.gameOptions ?? {})
            };

            this.client.CreateGame(req, this.buildGrpcMetadata(), (err: grpc.ServiceError | null, response: any) => {
                if (err) return reject(err);
                resolve(response.gameId);
            });
        });
    }

    public async connect(gameId: string, options?: { asSpectator?: boolean }): Promise<void> {
        this.gameId = gameId;

        const req = {
            gameId: gameId,
            asSpectator: !!options?.asSpectator,
            userToken: this.token
        };

        // サーバーサイドストリーミングの開始
        this.eventStream = this.client.StreamEvents(req, this.buildGrpcMetadata());

        this.eventStream!.on('data', (event: any) => {
            if (event.joined) {
                this.playerId = event.joined.assignedPlayerId;
                console.log("Joined game as player:", this.playerId);
            }
            else if (event.stateUpdate) {
                const update = event.stateUpdate;
                const state = JSON.parse(update.stateJson);
                this.onStateUpdate(state);

                if (this.onMetadataUpdate && update.metadata) {
                    this.onMetadataUpdate({
                        playerCount: update.metadata.playerCount,
                        spectatorCount: update.metadata.spectatorCount,
                        activePlayers: update.metadata.activePlayers || []
                    });
                }
            }
            else if (event.chatMessage) {
                this.onChatMessage?.(event.chatMessage);
            }
            else if (event.errorMessage) {
                this.onError(event.errorMessage);
            }
        });

        this.eventStream!.on('error', (err: any) => {
            // gRPCの正常終了(CANCELLED)はエラーとして扱わない
            if (err.code === grpc.status.CANCELLED) return;

            console.error("gRPC Stream Error:", err);
            this.onError(err.details || err.message || 'Stream connection error');
            this.disconnect();
        });

        this.eventStream!.on('end', () => {
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
                type: (action as any).type,
                payloadJson: JSON.stringify(action)
            }
        };

        this.client.DispatchAction(req, this.buildGrpcMetadata(), (err: grpc.ServiceError | null, response: any) => {
            if (err) {
                this.onError(err.details || err.message);
                return;
            }
            if (!response.success) {
                this.onError(response.message);
            }
        });
    }
}