// packages/shared/network/GenericGameServer.ts
import type { BaseGameState, BaseGameAction } from '../GameRules';
import { UniversalEngine } from '../UniversalEngine';

/**
 * 汎用的なゲームサーバー（あるいはルーム管理者）の基盤クラス。
 * UniversalEngineをラップし、WebSocketのPush通信（Broadcast）と、
 * Polling通信（Get）の両方に対応できる抽象化された通信層を提供します。
 */
export class GenericGameServer<TState extends BaseGameState, TAction extends BaseGameAction> {
    public engine: UniversalEngine<TState, TAction>;
    public roomId: string;

    // プレイヤーIDと、そのプレイヤーへの通信手段（コールバック等）の管理
    // WebSocketなどの場合はここに接続クライアントの参照を保持する
    private connectionMapping: Map<string, any> = new Map();

    constructor(roomId: string, engine: UniversalEngine<TState, TAction>) {
        this.roomId = roomId;
        this.engine = engine;
    }

    /**
     * クライアントからのアクションを受信したときのエンドポイント。
     * WebSocketのメッセージ受信イベントや、HTTP POST(Polling用)のエンドポイントから呼ばれる。
     */
    public handleAction(playerId: string, action: TAction): boolean {
        // セキュリティ: 送信元のplayerIdをアクションに強制付与（改ざん防止）
        action.playerId = playerId;
        action.timestamp = Date.now();

        const success = this.engine.dispatch(action);

        if (success) {
            // 状態が更新されたので、全プレイヤーに状態を配信（Push/Broadcast）する
            this.broadcastState();
        }

        return success;
    }

    /**
     * 【Polling用通信機能】
     * HTTP GETリクエストなどで、クライアントから現在の状態を要求された時に利用します。
     * 要求してきたプレイヤーのIDに応じて、安全にマスクされた状態を返します。
     * @param requestPlayerId 要求してきたプレイヤーのID
     */
    public getPollingState(requestPlayerId: string): TState {
        // エンジンから、要求者向けに適切にマスクされた状態を取得する
        return this.engine.getMaskedState(requestPlayerId);
    }

    /**
     * 【Push用通信機能】
     * WebSocketなどで、ゲーム状態に変更があった際に全プレイヤーへ新しい状態を配信します。
     */
    public broadcastState(): void {
        const state = this.engine.getState();

        // クライアント側で定義されたプレイヤー一覧を取得
        // (オブジェクトならキーを取得、配列ならそのまま)
        const players = state.players ? Object.values(state.players).filter(Boolean) as string[] : [];

        // 全ての参加プレイヤーに対して、個別にマスクした状態を送信する
        for (const playerId of players) {
            const maskedState = this.engine.getMaskedState(playerId);
            this.sendToClient(playerId, {
                type: 'STATE_UPDATE',
                state: maskedState
            });
        }

        // 観戦者（プレイヤーリストに含まれない人）への配信用
        // 引数なし（あるいは特殊なID）で全マスク状態を取得して送る
        const spectatorState = this.engine.getMaskedState('SPECTATOR');
        this.sendToSpectators({
            type: 'STATE_UPDATE',
            state: spectatorState
        });
    }

    /**
     * ----------------------------------------------------
     * 以下は実際の通信インフラ（WebSocket等）に合わせて実装する抽象メソッド
     * ----------------------------------------------------
     */

    // 特定のプレイヤーにメッセージを送信する処理
    private sendToClient(playerId: string, payload: any) {
        // 例: ws.send(JSON.stringify(payload))
        const connection = this.connectionMapping.get(playerId);
        if (connection && typeof connection.send === 'function') {
            connection.send(JSON.stringify(payload));
        } else {
            console.log(`[GenericGameServer] プレイヤー ${playerId} に状態を送信 (${JSON.stringify(payload).substring(0, 50)}...)`);
        }
    }

    // 観戦者全体にメッセージを送信する処理
    private sendToSpectators(_payload: any) {
        // 例: broadcast to all non-player connections
        console.log(`[GenericGameServer] 観戦者に状態を送信`);
    }

    // （参考）クライアント接続時の登録処理
    public registerConnection(playerId: string, connection: any) {
        this.connectionMapping.set(playerId, connection);
    }
}
