import type { BaseGameState } from '../GameRules';

export interface GameMetadata {
    playerCount: number;
    spectatorCount: number;
    activePlayers: string[]; // 接続中のユーザーIDリストなど
}

export interface GameCreateOptions {
    type?: string;
    gameOptions?: any;
    [key: string]: any;
}

export interface ChatMessage {
    userId: string;
    message: string;
    channel: 'public' | 'private';
    recipientId?: string;
    timestamp: string;
}

export interface INetworkClient<TState extends BaseGameState, TAction> {
    // 外部（UI層など）からセットされるコールバック
    onStateUpdate: (state: TState) => void;
    onError: (message: string) => void;
    onMetadataUpdate?: (metadata: GameMetadata) => void;
    onChatMessage?: (chat: ChatMessage) => void;

    // 接続・切断
    connect(gameId: string, options?: { asSpectator?: boolean }): Promise<void>;
    disconnect(): void;

    // ゲーム作成、そのIDを返す
    createGame(options?: GameCreateOptions): Promise<string>;

    // アクション送信
    sendAction(action: TAction): void | Promise<void>;

    // チャット送信
    sendChat?(message: string, channel: 'public' | 'private', recipientId?: string): void;

    // 現在のメタ情報を手動で取得したい場合用
    getMetadata?(): Promise<GameMetadata>;
}