// apps/backend/ai/ai-worker.ts
// Worker スレッド本体。このファイルは Worker として起動され、
// メインスレッドから渡されたゲーム状態・合法手を受け取り AI 計算を行い結果を返す。
import { parentPort } from "worker_threads";
import { gameRegistry } from "@engine/shared/GameRegistry";
import { MinimaxPlayer } from "@engine/shared/ai/AIPlayer/MinimaxPlayer";
import { MCTSPlayer } from "@engine/shared/ai/AIPlayer/MCTSPlayer";
import type { BaseGameAction } from "@engine/shared";

export interface WorkerRequest {
  /** 要求の一意な識別子（リクエスト・レスポンスの対応付けに使用） */
  requestId: string;
  /** AI の種別 */
  aiType: "minimax" | "mcts";
  /** ゲームタイプ（GameRegistry のキー） */
  gameType: string;
  /** AI 自身のプレイヤー ID */
  playerId: string;
  /** 現在のゲーム状態（JSON シリアライズ済み） */
  stateJson: string;
  /** 合法手リスト（JSON シリアライズ済み） */
  legalActionsJson: string;
  /** AI オプション（深さ上限, イテレーション数 等） */
  options?: {
    maxDepth?: number;
    iterations?: number;
    explorationConstant?: number;
    thinkDelayMs?: number;
  };
}

export interface WorkerResponse {
  requestId: string;
  /** 決定されたアクション（JSON シリアライズ済み）、手が無ければ null */
  actionJson: string | null;
  error?: string;
}

if (!parentPort) {
  throw new Error(
    "[ai-worker] parentPort が null です。このファイルは Worker として実行する必要があります。",
  );
}

parentPort.on("message", async (req: WorkerRequest) => {
  const { requestId, aiType, gameType, playerId, stateJson, legalActionsJson, options } = req;

  try {
    const def = gameRegistry.getDefinition(gameType);
    if (!def) {
      const res: WorkerResponse = {
        requestId,
        actionJson: null,
        error: `Unknown game type: ${gameType}`,
      };
      parentPort!.postMessage(res);
      return;
    }

    const state = JSON.parse(stateJson);
    const legalActions = JSON.parse(legalActionsJson);

    let action: BaseGameAction | null = null;

    if (aiType === "minimax") {
      const player = new MinimaxPlayer(
        playerId,
        def.ruleset,
        {
          maxDepth: options?.maxDepth ?? 3,
          thinkDelayMs: options?.thinkDelayMs ?? 0,
        },
        "MinimaxWorker",
      );
      action = await player.computeNextMove(state, legalActions);
    } else if (aiType === "mcts") {
      const player = new MCTSPlayer(
        playerId,
        def.ruleset,
        {
          iterations: options?.iterations ?? 1000,
          explorationConstant: options?.explorationConstant,
          thinkDelayMs: options?.thinkDelayMs ?? 0,
        },
        "MCTSWorker",
      );
      action = await player.computeNextMove(state, legalActions);
    }

    const res: WorkerResponse = {
      requestId,
      actionJson: action !== null ? JSON.stringify(action) : null,
    };
    parentPort!.postMessage(res);
  } catch (err: unknown) {
    const res: WorkerResponse = {
      requestId,
      actionJson: null,
      error: err instanceof Error ? err.message : String(err),
    };
    parentPort!.postMessage(res);
  }
});
