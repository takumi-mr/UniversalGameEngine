// apps/backend/ai/WorkerAIPlayer.ts
// IAIPlayer を実装するラッパー。
// computeNextMove() が呼ばれると worker_threads.Worker を起動し、
// ai-worker.ts に Minimax / MCTS の計算を委譲して Promise で結果を返す。
// これにより AI 思考中にメインスレッドのイベントループがブロックされなくなる。
import { Worker } from "worker_threads";
import path from "path";
import type { BaseGameState, BaseGameAction } from "@engine/shared/GameRules";
import type { IAIPlayer, AIDiagnosticValue } from "@engine/shared/ai/IAIPlayer";
import type { WorkerRequest, WorkerResponse } from "./ai-worker";

// ai-worker.ts のパスを解決する
// bun run dev では TypeScript ファイルをそのまま実行できるため .ts 拡張子を使用する
const WORKER_PATH = path.resolve(__dirname, "ai-worker.ts");

export type AIType = "minimax" | "mcts";

export interface WorkerAIOptions {
  maxDepth?: number;
  iterations?: number;
  explorationConstant?: number;
  thinkDelayMs?: number;
}

/**
 * AI 計算を Worker スレッドに委譲する IAIPlayer 実装。
 * MinimaxPlayer / MCTSPlayer をメインスレッドで直接実行する代わりに使用する。
 */
export class WorkerAIPlayer<
  TState extends BaseGameState = BaseGameState,
  TAction extends BaseGameAction = BaseGameAction,
> implements IAIPlayer<TState, TAction> {
  public readonly name: string;
  public readonly playerId: string;

  private readonly gameType: string;
  private readonly aiType: AIType;
  private readonly options: WorkerAIOptions;

  /** リクエスト ID → Promise の resolve/reject を保持するマップ */
  private pendingRequests = new Map<
    string,
    { resolve: (action: TAction | null) => void; reject: (err: Error) => void }
  >();

  /** 現在起動中の Worker（再利用する） */
  private worker: Worker | null = null;
  private requestCounter = 0;

  constructor(
    playerId: string,
    gameType: string,
    aiType: AIType,
    options: WorkerAIOptions = {},
    name?: string,
  ) {
    this.playerId = playerId;
    this.gameType = gameType;
    this.aiType = aiType;
    this.options = options;
    this.name = name ?? `${aiType === "minimax" ? "Minimax" : "MCTS"} Worker (${playerId})`;
  }

  // -----------------------------------------------------------------------
  // IAIPlayer 実装
  // -----------------------------------------------------------------------

  public async computeNextMove(state: TState, legalActions: TAction[]): Promise<TAction | null> {
    if (!legalActions || legalActions.length === 0) {
      return null;
    }

    const requestId = `${this.playerId}_${++this.requestCounter}`;
    const req: WorkerRequest = {
      requestId,
      aiType: this.aiType,
      gameType: this.gameType,
      playerId: this.playerId,
      stateJson: JSON.stringify(state),
      legalActionsJson: JSON.stringify(legalActions),
      options: this.options,
    };

    return new Promise<TAction | null>((resolve, reject) => {
      this.pendingRequests.set(requestId, { resolve, reject });

      const worker = this.getOrCreateWorker();
      worker.postMessage(req);
    });
  }

  public reset(): void {
    // 未完了リクエストをすべてキャンセル（null で解決）
    for (const { resolve } of this.pendingRequests.values()) {
      resolve(null);
    }
    this.pendingRequests.clear();

    // Worker を終了して次回再生成できるようにする
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
  }

  public getDiagnostics(): Record<string, AIDiagnosticValue> {
    return {
      playerId: this.playerId,
      aiType: this.aiType,
      gameType: this.gameType,
      pendingRequests: this.pendingRequests.size,
      workerAlive: this.worker !== null,
    };
  }

  // -----------------------------------------------------------------------
  // 内部ヘルパー
  // -----------------------------------------------------------------------

  /**
   * Worker を取得または新規生成する。
   * bun の場合は extensionForced を設定して .ts ファイルを直接渡す。
   */
  private getOrCreateWorker(): Worker {
    if (this.worker) {
      return this.worker;
    }

    const worker = new Worker(WORKER_PATH);
    this.worker = worker;

    worker.on("message", (res: WorkerResponse) => {
      const pending = this.pendingRequests.get(res.requestId);
      if (!pending) return;

      this.pendingRequests.delete(res.requestId);

      if (res.error) {
        pending.reject(new Error(`[WorkerAIPlayer:${this.playerId}] ${res.error}`));
      } else {
        const action = res.actionJson ? (JSON.parse(res.actionJson) as TAction) : null;
        pending.resolve(action);
      }
    });

    worker.on("error", (err) => {
      console.error(`[WorkerAIPlayer:${this.playerId}] Worker error:`, err);
      // 全ての保留中リクエストをエラーで解決
      for (const { reject } of this.pendingRequests.values()) {
        reject(err);
      }
      this.pendingRequests.clear();
      this.worker = null;
    });

    worker.on("exit", (code) => {
      if (code !== 0) {
        console.warn(`[WorkerAIPlayer:${this.playerId}] Worker exited with code ${code}`);
      }
      // 残留しているリクエストは null で解決（ゲーム続行を妨げないように）
      for (const { resolve } of this.pendingRequests.values()) {
        resolve(null);
      }
      this.pendingRequests.clear();
      this.worker = null;
    });

    return worker;
  }
}
