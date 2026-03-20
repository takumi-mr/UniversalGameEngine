// apps/backend/network/StreamManager.ts
import * as grpc from '@grpc/grpc-js';

type GrpcStream = grpc.ServerWritableStream<any, any>;

interface StreamInfo {
    userId: string;
    stream: GrpcStream;
}

class StreamManager {
    private activeStreams = new Map<string, Set<StreamInfo>>();

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

    /**
     * ゲーム内の全gRPCストリームに通知を送る
     * eventGenerator は各ユーザーのIDを受け取り、そのユーザー向けにマスクされたイベントオブジェクトを返す
     */
    public notify(gameId: string, eventGenerator: (userId: string) => any) {
        const streams = this.activeStreams.get(gameId);
        if (streams) {
            for (const info of streams) {
                try {
                    const event = eventGenerator(info.userId);
                    info.stream.write(event);
                } catch (err) {
                    console.error(`[StreamManager] Failed to write to stream for user ${info.userId} in game ${gameId}:`, err);
                }
            }
        }
    }

    /**
     * 特定のイベント（チャットなど、全員共通のもの）を全gRPCストリームに通知する
     */
    public broadcast(gameId: string, event: any) {
        const streams = this.activeStreams.get(gameId);
        if (streams) {
            for (const info of streams) {
                try {
                    info.stream.write(event);
                } catch (err) {
                    console.error(`[StreamManager] Failed to broadcast to stream for user ${info.userId} in game ${gameId}:`, err);
                }
            }
        }
    }
}

export const streamManager = new StreamManager();
