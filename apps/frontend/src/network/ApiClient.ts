// src/network/ApiClient.ts
import type { GameState, MoveAction } from '../../../../packages/shared/interfaces';

export class RestPollingClient {
    private baseUrl: string;
    public gameId: string | null = null;
    private pollInterval: ReturnType<typeof setInterval> | null = null;

    // 外部（Vueコンポーネント）からセットされるコールバック
    public onStateUpdate: (state: GameState) => void = () => {};
    public onError: (message: string) => void = () => {};

    constructor(baseUrl: string) {
        this.baseUrl = baseUrl;
    }

    public async createGame(size: number): Promise<string> {
        try {
            const response = await fetch(this.baseUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ size })
            });
            const data = await response.json();
            this.connect(data.gameId);
            return data.gameId;
        } catch (err) {
            this.onError("Failed to create game");
            throw err;
        }
    }

    public async connect(gameId: string): Promise<void> {
        this.gameId = gameId;
        this.stopPolling();
        
        await this.fetchState();
        
        // 2秒ごとにポーリング
        this.pollInterval = setInterval(() => this.fetchState(), 2000);
    }

    public async sendMove(action: MoveAction): Promise<void> {
        if (!this.gameId) return;
        try {
            const response = await fetch(`${this.baseUrl}/${this.gameId}/moves`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(action)
            });
            const data = await response.json();
            
            if (data.success) {
                this.onStateUpdate(data.state);
            } else {
                console.warn("Invalid move:", data.error);
            }
        } catch (err) {
            this.onError("Failed to send move");
        }
    }

    private async fetchState(): Promise<void> {
        if (!this.gameId) return;
        try {
            const response = await fetch(`${this.baseUrl}/${this.gameId}`);
            if (!response.ok) throw new Error('Game not found');
            const state: GameState = await response.json();
            this.onStateUpdate(state);
        } catch (err) {
            this.stopPolling();
            this.onError("Game not found or disconnected");
        }
    }

    public stopPolling(): void {
        if (this.pollInterval) {
            clearInterval(this.pollInterval);
            this.pollInterval = null;
        }
    }
}