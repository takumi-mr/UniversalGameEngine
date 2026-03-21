import { UniversalEngine } from "@engine/shared/UniversalEngine";
import { HybridGameRepository } from "../infra/HybridGameRepository";
import { GenericGameServer } from "@engine/shared/network/GenericGameServer";
import { Server } from "socket.io";
import { compare } from "fast-json-patch";
import { calculateStateHash } from "@engine/shared";
import { streamManager } from "../network/StreamManager";
import type { IAIPlayer } from "@engine/shared/ai/IAIPlayer";
import { gameRegistry } from "@engine/shared/GameRegistry";

export class SocketGameServer extends GenericGameServer<any, any> {
  private io: Server;
  // ソケットごとに最後に送信した「マスク済み状態」を記録する
  private lastSentState: Map<string, any> = new Map();

  // ゲームタイプ（ensureSession / saveSession で使用）
  public gameType: string = "";

  // AIプレイヤーの管理と、思考中の重複呼び出し防止
  public aiPlayers: Map<string, IAIPlayer<any, any>> = new Map();
  private computingAIPlayers: Set<string> = new Set();

  constructor(roomId: string, engine: UniversalEngine<any, any>, io: Server, gameType?: string) {
    super(roomId, engine);
    this.io = io;
    this.gameType = gameType ?? "";
  }

  public override broadcastState(targetSocketId?: string): void {
    const state = this.engine.getState();
    const players = state.players ? (Object.values(state.players).filter(Boolean) as string[]) : [];
    const isForceFull = !!targetSocketId;

    // ★ Redis に最新状態をゲームタイプごと書き込む（ステートレス化の核心）
    // 全ての状態変化（人間着手・AI着手の両方）をカバーする
    if (this.gameType) {
      repo
        .saveSession(this.roomId, this.gameType, state, state.status === "FINISHED")
        .catch((err) =>
          console.error(`[Redis] Failed to save session for game ${this.roomId}:`, err),
        );
    }

    this.io
      .in(this.roomId)
      .fetchSockets()
      .then((sockets) => {
        for (const socket of sockets) {
          // targetSocketId が指定されている場合はそのソケットのみ処理、そうでなければ全員
          if (targetSocketId && socket.id !== targetSocketId) continue;

          const userId = socket.data.userId;
          const targetId = players.includes(userId) ? userId : "SPECTATOR";
          const maskedState = this.engine.getMaskedState(targetId);

          // version と hash を付与
          maskedState.version = state.version;
          maskedState.hash = calculateStateHash(maskedState);

          const socketId = socket.id;
          const previousState = this.lastSentState.get(socketId);

          // 強制フル更新でない場合、かつ以前の状態がある場合は差分を試みる
          if (
            !isForceFull &&
            previousState &&
            previousState.version !== undefined &&
            previousState.version < maskedState.version
          ) {
            // 差分（パッチ）を生成
            const patch = compare(previousState, maskedState);

            if (patch.length > 0) {
              const patchPayload = JSON.stringify(patch);
              const statePayload = JSON.stringify(maskedState);

              // パッチの方が明らかに小さい場合のみ差分送信
              if (patchPayload.length < statePayload.length * 0.8) {
                socket.emit("state-patch", {
                  patch,
                  baseVersion: previousState.version,
                  targetVersion: maskedState.version,
                  hash: maskedState.hash,
                });
                this.lastSentState.set(socketId, JSON.parse(statePayload));
                continue;
              }
            }
          }

          // 初回送信、パッチの方が大きい場合、または強制フル更新の場合はフルデータを送信
          socket.emit("state-update", maskedState);
          this.lastSentState.set(socketId, JSON.parse(JSON.stringify(maskedState)));
        }
      })
      .catch((err) => console.error("Broadcast error:", err));

    // gRPC ストリームへの通知
    streamManager.notify(this.roomId, (userId) => {
      const targetId = players.includes(userId) ? userId : "SPECTATOR";
      const maskedState = this.engine.getMaskedState(targetId);
      maskedState.version = state.version;
      maskedState.hash = calculateStateHash(maskedState);

      return {
        stateUpdate: {
          stateJson: JSON.stringify(maskedState),
          metadata: {
            playerCount: players.length,
            activePlayers: players,
          },
        },
      };
    });

    // AIのターンであれば自動実行する
    this.checkAndExecuteAiTurns();
  }

  private checkAndExecuteAiTurns() {
    const state = this.engine.getState();
    if (state.status !== "PLAYING") return;

    // 手番プレイヤーリストを取得。空の場合は「いずれかのAIに合法手があるか」をチェックして補足する
    const activePlayerIds = state.activePlayers || [];
    if (activePlayerIds.length === 0) {
      for (const [playerId] of this.aiPlayers) {
        if (this.engine.getLegalActions(playerId).length > 0) {
          activePlayerIds.push(playerId);
        }
      }
    }

    for (const playerId of activePlayerIds) {
      const aiPlayer = this.aiPlayers.get(playerId);
      if (aiPlayer && !this.computingAIPlayers.has(playerId)) {
        this.computingAIPlayers.add(playerId);

        const legalActions = this.engine.getLegalActions(playerId);
        if (legalActions.length === 0) {
          this.computingAIPlayers.delete(playerId);
          continue;
        }

        aiPlayer
          .computeNextMove(state, legalActions)
          .then((action) => {
            this.computingAIPlayers.delete(playerId);

            // ゲームの状態が依然として進行中で、かつAIが依然としてそのプレイヤーとしてのアクションが可能か確認
            const currentState = this.engine.getState();
            const currentLegal = this.engine.getLegalActions(playerId);
            const canStillAct = currentLegal.some(
              (a) => JSON.stringify(a) === JSON.stringify(action),
            );

            if (currentState.status === "PLAYING" && canStillAct && action) {
              this.handleAction(playerId, action);
            }
          })
          .catch((err) => {
            this.computingAIPlayers.delete(playerId);
            console.error(`[AI] Error computing move for player ${playerId}:`, err);
          });
      }
    }
  }

  public handleDisconnect(socketId: string): void {
    this.lastSentState.delete(socketId);
  }
}

export interface GameSession {
  server: SocketGameServer;
  type: string;
}

export const sessions = new Map<string, GameSession>();
export const cleanupTimers = new Map<string, NodeJS.Timeout>();

export const EMPTY_ROOM_TIMEOUT = 5 * 60 * 1000; // 5 minutes

export const repo = new HybridGameRepository<any>(
  process.env.REDIS_URL || "redis://localhost:6379",
  process.env.MONGO_URL || "mongodb://localhost:27017",
);

/**
 * ★ セッションをメモリから取得する。存在しない場合は Redis / MongoDB から復元する。
 * これにより、バックエンドをステートレスにしてスケールアウト可能にする。
 *
 * @param gameId ゲーム ID
 * @param io Socket.IO サーバーインスタンス
 * @returns ゲームセッション、または null（存在しない場合）
 */
export async function ensureSession(gameId: string, io: Server): Promise<GameSession | null> {
  // 1. まずメモリキャッシュをチェック（最速）
  const existing = sessions.get(gameId);
  if (existing) return existing;

  // 2. Redis / MongoDB から { type, state } を復元する
  let savedData: { type: string; state: any } | null = null;
  try {
    savedData = await repo.loadSession(gameId);
  } catch (err) {
    console.error(`[ensureSession] Failed to load session ${gameId} from storage:`, err);
  }

  if (!savedData || !savedData.type) return null;

  const def = gameRegistry.getDefinition(savedData.type);
  if (!def) {
    console.warn(`[ensureSession] Unknown game type '${savedData.type}' for game ${gameId}`);
    return null;
  }

  const engine = new UniversalEngine(def.ruleset, {});
  engine.loadState(savedData.state);
  const normalizedType = savedData.type.toLowerCase().replace(/-/g, "_");
  const server = new SocketGameServer(gameId, engine, io, normalizedType);
  const session: GameSession = { server, type: normalizedType };

  sessions.set(gameId, session);
  console.log(`[ensureSession] Game ${gameId} restored from storage (type: ${savedData.type})`);
  return session;
}
