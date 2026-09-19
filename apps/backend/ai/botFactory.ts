// apps/backend/ai/botFactory.ts
import type { BotSpec } from "@engine/shared/stores/repository";
import type { IAIPlayer } from "@engine/shared/ai/IAIPlayer";
import type { BaseGameAction, BaseGameState } from "@engine/shared/GameRules";
import type { UniversalEngine } from "@engine/shared/UniversalEngine";
import { GrpcBotPlayer } from "@engine/shared/ai/AIPlayer/GrpcBotPlayer";
import { RandomPlayer } from "@engine/shared/ai/AIPlayer/RandomPlayer";
import { aiTensorRegistry } from "@engine/shared/ai/AITensorAdapterRegistry";
import "@engine/shared/ai/TensorAdapter";
import { WorkerAIPlayer } from "@engine/backend/ai/WorkerAIPlayer";
import { notifyBotTurn } from "@engine/backend/network/StreamManager";

/** ルーム作成時に指定できる AI の種別 */
export const BOT_TYPES = ["grpc_bot", "random", "minimax", "mcts"] as const;
export type BotType = (typeof BOT_TYPES)[number];

export const isBotType = (aiType: string): aiType is BotType =>
  (BOT_TYPES as readonly string[]).includes(aiType);

/**
 * gRPC ボットへ送る手番データ（観測・合法手・局面）。テンソルアダプタ未登録なら null。
 * 局面 `stateJson` はボット自身の視点でマスクしたもの（`engine.getMaskedState(botId)`）で、
 * 他のプレイヤーへの配信と同じ条件（Secret は展開済み・`prngSecret` なし）。
 * 外部プロセスは信頼できないので、マスク前の状態を流してはいけない。
 * 観測テンソル・合法手はアダプタ / ルールセットが Secret 付きの状態を前提にするので、
 * マスク前の状態から計算する（アダプタは botId 視点の観測を返す責務を持つ）。
 */
export function encodeBotTurn(
  gameType: string,
  engine: UniversalEngine<BaseGameState, BaseGameAction>,
  botId: string,
): { stateTensor: number[]; legalActionIds: number[]; stateJson: string } | null {
  const adapter = aiTensorRegistry.getAdapter(gameType);
  if (!adapter) return null;
  const state = engine.getState();
  return {
    stateTensor: adapter.encodeState(state, botId),
    legalActionIds: state.activePlayers?.includes(botId)
      ? adapter.encodeLegalActions(state, botId)
      : [],
    stateJson: JSON.stringify(engine.getMaskedState(botId)),
  };
}

/**
 * BotSpec（永続化される定義）から実行時の AI プレイヤーを生成する。
 * セッションを別インスタンスで復元するときも同じ関数で再生成する。
 * @param engine セッションのエンジン（gRPC ボットへ送る局面をボット視点でマスクするために使う）
 */
export function createBotPlayer(
  spec: BotSpec,
  gameId: string,
  gameType: string,
  engine: UniversalEngine<BaseGameState, BaseGameAction>,
): IAIPlayer<BaseGameState, BaseGameAction> | null {
  const { playerId: botId, aiType } = spec;
  const idx = spec.name ?? botId;

  switch (aiType) {
    case "grpc_bot":
      // 手番の通知は checkAndExecuteAiTurns → computeNextMove から同期的に呼ばれるので、
      // 渡される局面はエンジンの現在の状態と同じ。マスクのためにエンジンから読み直す
      return new GrpcBotPlayer(botId, spec.name ?? `gRPC Bot ${idx}`, () => {
        const turn = encodeBotTurn(gameType, engine, botId);
        if (!turn) return;
        // ボットの gRPC ストリームは別インスタンスに繋がっている可能性があるのでクラスタ経由で通知する
        notifyBotTurn(gameId, botId, turn.stateTensor, turn.legalActionIds, turn.stateJson);
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
