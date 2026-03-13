// apps/frontend/src/network/ApiClient.ts
import type { INetworkClient } from '@engine/shared/network/INetworkClient';

export class RestPollingClient<TState, TAction> implements INetworkClient<TState, TAction> {
    private baseUrl: string;
    public gameId: string | null = null;
    private pollInterval: ReturnType<typeof setInterval> | null = null;

    public onStateUpdate: (state: TState) => void = () => {};
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
            // 自動的に接続
            await this.connect(data.gameId);
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
        this.pollInterval = setInterval(() => this.fetchState(), 2000);
    }

    public disconnect(): void {
        this.stopPolling();
    }

    public async sendAction(action: TAction): Promise<void> {
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
            }
        } catch (err) {
            this.onError("Failed to send action");
        }
    }

    private async fetchState(): Promise<void> {
        if (!this.gameId) return;
        try {
            const response = await fetch(`${this.baseUrl}/${this.gameId}`);
            if (!response.ok) throw new Error('Game not found');
            const state: TState = await response.json();
            this.onStateUpdate(state);
        } catch (err) {
            this.stopPolling();
            this.onError("Game not found or disconnected");
        }
    }

    private stopPolling(): void {
        if (this.pollInterval) {
            clearInterval(this.pollInterval);
            this.pollInterval = null;
        }
    }
}