import type { BaseGameAction, BaseGameState } from "@engine/shared/GameRules";

/**
 * 状態配信（state-update の第 2 引数 / state-patch の追加フィールド）に同梱される付随情報。
 * action はその更新を生んだアクション（サーバーの dispatchAction 経由のときだけ入る。
 * JOIN / START / 離席・再同期では undefined）。クライアントの演出・効果音の判定に使う。
 */
export interface StateUpdateMeta {
  action?: BaseGameAction;
}

export interface GameMetadata {
  playerCount: number;
  spectatorCount: number;
  activePlayers: string[]; // 接続中のユーザーIDリストなど
}

export interface GameCreateOptions {
  type?: string;
  gameOptions?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface ChatMessage {
  userId: string;
  message: string;
  channel: "public" | "private";
  recipientId?: string;
  timestamp: string;
}

export interface INetworkClient<TState extends BaseGameState, TAction> {
  // 外部（UI層など）からセットされるコールバック
  // meta.action はその更新を生んだアクション（配信元が同梱したときだけ）
  onStateUpdate: (state: TState, meta?: StateUpdateMeta) => void;
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
  sendChat?(message: string, channel: "public" | "private", recipientId?: string): void;

  // 現在のメタ情報を手動で取得したい場合用
  getMetadata?(): Promise<GameMetadata>;
}
