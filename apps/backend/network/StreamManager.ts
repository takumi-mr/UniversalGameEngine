// apps/backend/network/StreamManager.ts
import * as grpc from "@grpc/grpc-js";
import { publishClusterEvent } from "@engine/backend/network/io";
import type { GameEvent } from "@engine/shared/network/generated/universal_game_engine/GameEvent";
import type { JoinGameRequest__Output } from "@engine/shared/network/generated/universal_game_engine/JoinGameRequest";
import type { WaitForTurnRequest__Output } from "@engine/shared/network/generated/universal_game_engine/WaitForTurnRequest";
import type { WaitForTurnResponse } from "@engine/shared/network/generated/universal_game_engine/WaitForTurnResponse";

/** StreamEvents のサーバーストリーム（対局イベントの購読） */
type GrpcStream = grpc.ServerWritableStream<JoinGameRequest__Output, GameEvent>;
/** WaitForTurn のサーバーストリーム（gRPC ボットの手番待ち） */
type BotStream = grpc.ServerWritableStream<WaitForTurnRequest__Output, WaitForTurnResponse>;

interface StreamInfo {
  userId: string;
  stream: GrpcStream;
}

class StreamManager {
  private activeStreams = new Map<string, Set<StreamInfo>>();

  // AI用待機ストリーム (gameId -> playerId -> stream)
  private botStreams = new Map<string, Map<string, BotStream>>();

  /**
   * ストリームを登録する
   */
  public addStream(gameId: string, userId: string, stream: GrpcStream) {
    if (!this.activeStreams.has(gameId)) {
      this.activeStreams.set(gameId, new Set());
    }
    this.activeStreams.get(gameId)!.add({ userId, stream });
  }

  /**
   * ストリームを解除する
   */
  public removeStream(gameId: string, stream: GrpcStream) {
    const streams = this.activeStreams.get(gameId);
    if (streams) {
      for (const info of streams) {
        if (info.stream === stream) {
          streams.delete(info);
          break;
        }
      }
      if (streams.size === 0) {
        this.activeStreams.delete(gameId);
      }
    }
  }

  /** このインスタンスに、そのゲームを購読しているストリームがあるか */
  public hasStreams(gameId: string): boolean {
    return (this.activeStreams.get(gameId)?.size ?? 0) > 0;
  }

  /**
   * ゲーム内の全gRPCストリームに通知を送る
   * eventGenerator は各ユーザーのIDを受け取り、そのユーザー向けにマスクされたイベントオブジェクトを返す
   */
  public notify(gameId: string, eventGenerator: (userId: string) => GameEvent) {
    const streams = this.activeStreams.get(gameId);
    if (streams) {
      for (const info of streams) {
        try {
          const event = eventGenerator(info.userId);
          info.stream.write(event);
        } catch (err) {
          console.error(
            `[StreamManager] Failed to write to stream for user ${info.userId} in game ${gameId}:`,
            err,
          );
        }
      }
    }
  }

  /**
   * 特定のイベント（チャットなど、全員共通のもの）を全gRPCストリームに通知する
   */
  public broadcast(gameId: string, event: GameEvent) {
    const streams = this.activeStreams.get(gameId);
    if (streams) {
      for (const info of streams) {
        try {
          info.stream.write(event);
        } catch (err) {
          console.error(
            `[StreamManager] Failed to broadcast to stream for user ${info.userId} in game ${gameId}:`,
            err,
          );
        }
      }
    }
  }

  /**
   * AIボットのターン待ち受けストリームを登録する
   */
  public addBotStream(gameId: string, playerId: string, stream: BotStream) {
    if (!this.botStreams.has(gameId)) {
      this.botStreams.set(gameId, new Map());
    }
    this.botStreams.get(gameId)!.set(playerId, stream);
  }

  /**
   * AIボットのストリームを解除する
   */
  public removeBotStream(gameId: string, playerId: string) {
    const gameStreams = this.botStreams.get(gameId);
    if (gameStreams) {
      gameStreams.delete(playerId);
      if (gameStreams.size === 0) {
        this.botStreams.delete(gameId);
      }
    }
  }

  /**
   * 特別のAIプレイヤーにターンが回ってきたことを通知する
   */
  public notifyBotTurn(
    gameId: string,
    playerId: string,
    stateTensor: number[],
    legalActionIds: number[],
    stateJson: string,
  ) {
    const gameStreams = this.botStreams.get(gameId);
    if (gameStreams) {
      const stream = gameStreams.get(playerId);
      if (stream) {
        try {
          stream.write({
            stateTensor,
            legalActionIds,
            stateJson,
          });
        } catch (err) {
          console.error(
            `[StreamManager] Failed to send turn data to bot ${playerId} in game ${gameId}:`,
            err,
          );
        }
      }
    }
  }
}

export const streamManager = new StreamManager();

/**
 * gRPC ボットへ手番を通知する。ボットの待ち受けストリームは別のインスタンスに繋がっている
 * かもしれないので、ローカルに配った上でクラスタにも流す。
 */
export function notifyBotTurn(
  gameId: string,
  playerId: string,
  stateTensor: number[],
  legalActionIds: number[],
  stateJson: string,
): void {
  streamManager.notifyBotTurn(gameId, playerId, stateTensor, legalActionIds, stateJson);
  publishClusterEvent("uge:bot-turn", { gameId, playerId, stateTensor, legalActionIds, stateJson });
}
