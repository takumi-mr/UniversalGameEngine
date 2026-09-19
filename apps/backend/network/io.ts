// apps/backend/network/io.ts
// Socket.IO サーバーインスタンスの保持と、インスタンス間通知（クラスタイベント）の送受信。
//
// 複数のバックエンドインスタンスを Redis アダプタで束ねているとき、
// 「どのインスタンスが対局を進めたか」に関係なく、全インスタンスが自分に接続している
// クライアント（Socket.io / gRPC ストリーム）へ最新状態を配れるようにするための仕組み。
// 通知には Socket.io の serverSideEmit（アダプタの pub/sub）をそのまま使う。
import { randomUUID } from "crypto";
import type { Server } from "socket.io";
import type { BaseGameAction } from "@engine/shared/GameRules";

/** このプロセスを識別する ID（自分が発行したイベントを無視するために使う） */
export const INSTANCE_ID = randomUUID();

let ioInstance: Server | null = null;
let clusterEnabled = false;

export const setIoInstance = (io: Server, options: { cluster?: boolean } = {}) => {
  ioInstance = io;
  clusterEnabled = options.cluster ?? false;
};

export const getIoInstance = (): Server => {
  if (!ioInstance) throw new Error("Socket.IO not initialized");
  return ioInstance;
};

export const isClusterEnabled = () => clusterEnabled;

export interface ClusterEvents {
  /**
   * 対局の状態が更新された（保存済み）。各インスタンスは自分のクライアントへ配信し直す。
   * action はこの更新を生んだアクション（dispatchAction 経由のときだけ。クライアントの演出・効果音用）
   */
  "uge:state-changed": { gameId: string; version: number; action?: BaseGameAction };
  /** セッションが削除された。各インスタンスはローカルキャッシュを捨てる */
  "uge:session-deleted": { gameId: string };
  /** gRPC ボットの手番が来た。ボットのストリームを持つインスタンスが転送する */
  "uge:bot-turn": {
    gameId: string;
    playerId: string;
    stateTensor: number[];
    legalActionIds: number[];
    /** 完全な局面の JSON（ボットが Simulate で木探索するときの親局面） */
    stateJson: string;
  };
}

type ClusterPayload<E extends keyof ClusterEvents> = ClusterEvents[E] & { origin: string };

/**
 * 他のインスタンスへイベントを送る（自分には届かない）。
 * 単一インスタンス構成（インメモリアダプタ）では何もしない。
 */
export function publishClusterEvent<E extends keyof ClusterEvents>(
  event: E,
  payload: ClusterEvents[E],
): void {
  if (!clusterEnabled || !ioInstance) return;
  const message: ClusterPayload<E> = { ...payload, origin: INSTANCE_ID };
  try {
    ioInstance.serverSideEmit(event, message);
  } catch (err) {
    console.error(`[Cluster] Failed to publish ${event}:`, err);
  }
}

/** 他のインスタンスからのイベントを購読する */
export function onClusterEvent<E extends keyof ClusterEvents>(
  event: E,
  handler: (payload: ClusterEvents[E]) => void | Promise<void>,
): void {
  if (!ioInstance) throw new Error("Socket.IO not initialized");
  ioInstance.on(event as string, (payload: ClusterPayload<E>) => {
    if (payload?.origin === INSTANCE_ID) return;
    Promise.resolve(handler(payload)).catch((err) =>
      console.error(`[Cluster] Handler for ${event} failed:`, err),
    );
  });
}

/** このインスタンスに接続しているソケットのうち、room に居るものだけを返す */
export async function fetchLocalSockets(room: string) {
  return getIoInstance().local.in(room).fetchSockets();
}

/** クラスタ全体で room に居るソケット数（アダプタ越しに他インスタンスへ問い合わせる） */
export async function countRoomSockets(room: string): Promise<number> {
  const sockets = await getIoInstance().in(room).fetchSockets();
  return sockets.length;
}
