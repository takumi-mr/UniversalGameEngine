// apps/backend/ai/botFactory.ts
import type { BotSpec } from "@engine/shared/stores/repository";
import type { IAIPlayer } from "@engine/shared/ai/IAIPlayer";
import { GrpcBotPlayer } from "@engine/shared/ai/AIPlayer/GrpcBotPlayer";
import { RandomPlayer } from "@engine/shared/ai/AIPlayer/RandomPlayer";
import { aiTensorRegistry } from "@engine/shared/ai/AITensorAdapterRegistry";
import "@engine/shared/ai/TensorAdapter";
import { WorkerAIPlayer } from "./WorkerAIPlayer";
import { notifyBotTurn } from "../network/StreamManager";

/** ルーム作成時に指定できる AI の種別 */
export const BOT_TYPES = ["grpc_bot", "random", "minimax", "mcts"] as const;
export type BotType = (typeof BOT_TYPES)[number];

export const isBotType = (aiType: string): aiType is BotType =>
  (BOT_TYPES as readonly string[]).includes(aiType);

/**
 * BotSpec（永続化される定義）から実行時の AI プレイヤーを生成する。
 * セッションを別インスタンスで復元するときも同じ関数で再生成する。
 */
export function createBotPlayer(
  spec: BotSpec,
  gameId: string,
  gameType: string,
): IAIPlayer<any, any> | null {
  const { playerId: botId, aiType } = spec;
  const idx = spec.name ?? botId;

  switch (aiType) {
    case "grpc_bot":
      return new GrpcBotPlayer(botId, spec.name ?? `gRPC Bot ${idx}`, (turnState, _legal) => {
        const adapter = aiTensorRegistry.getAdapter(gameType);
        if (!adapter) return;
        const stateTensor = adapter.encodeState(turnState, botId);
        const legalActionIds = turnState.activePlayers?.includes(botId)
          ? adapter.encodeLegalActions(turnState, botId)
          : [];
        // ボットの gRPC ストリームは別インスタンスに繋がっている可能性があるのでクラスタ経由で通知する
        notifyBotTurn(gameId, botId, stateTensor, legalActionIds);
      });
    case "random":
      return new RandomPlayer(botId, spec.name ?? `Random AI ${idx}`);
    case "minimax":
      // WorkerAIPlayer に委譲してメインスレッドをブロックしない
      return new WorkerAIPlayer(
        botId,
        gameType,
        "minimax",
        { maxDepth: 3 },
        spec.name ?? `Minimax AI ${idx}`,
      );
    case "mcts":
      return new WorkerAIPlayer(
        botId,
        gameType,
        "mcts",
        { iterations: 1000 },
        spec.name ?? `MCTS AI ${idx}`,
      );
    default:
      return null;
  }
}
