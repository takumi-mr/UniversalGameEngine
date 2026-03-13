export interface GameMetadata {
    playerCount: number;
    spectatorCount: number;
    activePlayers: string[]; // 接続中のユーザーIDリストなど
}

export interface INetworkClient<TState, TAction> {
    // 外部（UI層など）からセットされるコールバック
    onStateUpdate: (state: TState) => void;
    onError: (message: string) => void;

    // 接続・切断
    connect(gameId: string): Promise<void>;
    disconnect(): void;

    // ゲーム作成、そのIDを返す
    createGame(options?: any): Promise<string>;

    // アクション送信
    sendAction(action: TAction): void | Promise<void>;

    // 現在のメタ情報を手動で取得したい場合用
    getMetadata?(): Promise<GameMetadata>;
}