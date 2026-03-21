// packages/shared/ai/GrpcBotPlayer.ts
import type { BaseGameState, BaseGameAction } from '../GameRules';
import type { IAIPlayer } from './IAIPlayer';

/**
 * 外部のgRPCクライアント（Pythonなど）が操作するためのAIプレイヤー実装。
 * computeNextMoveが呼ばれるとPromiseを返し、外部から submitMove が呼ばれるまで待機します。
 */
export class GrpcBotPlayer<TState extends BaseGameState, TAction extends BaseGameAction>
    implements IAIPlayer<TState, TAction> {

    public readonly name: string;
    public readonly playerId: string;

    // 外部（gRPC等）にターン開始を通知するためのコールバック
    private _onTurnStart?: (state: TState, legalActions: TAction[]) => void;

    // gRPCサーバー側からアクションを解決するためのコールバック
    private _resolveMove: ((action: TAction) => void) | null = null;
    
    // 現在このプレイヤーがターンを待機中かどうか
    public get isWaitingForMove(): boolean {
        return this._resolveMove !== null;
    }

    constructor(
        playerId: string, 
        name: string = "gRPC Bot",
        onTurnStart?: (state: TState, legalActions: TAction[]) => void
    ) {
        this.playerId = playerId;
        this.name = name;
        this._onTurnStart = onTurnStart;
    }

    public async computeNextMove(state: TState, legalActions: TAction[]): Promise<TAction | null> {
        if (!legalActions || legalActions.length === 0) {
            return null;
        }

        // 外部（gRPCサーバー経由）から submitMove が呼ばれるまで待機する
        return new Promise((resolve) => {
            this._resolveMove = resolve;
            if (this._onTurnStart) {
                this._onTurnStart(state, legalActions);
            }
        });
    }

    /**
     * gRPCサーバー側（grpc-server.ts）からアクションを受信した際に呼ばれる
     */
    public submitMove(action: TAction): boolean {
        if (this._resolveMove) {
            const resolve = this._resolveMove;
            this._resolveMove = null;
            // プレイヤーIDを強制付与して返す
            resolve({
                ...action,
                playerId: this.playerId
            });
            return true;
        }
        return false;
    }

    public reset(): void {
        this._resolveMove = null;
    }
}
