import { UniversalEngine } from "./UniversalEngine";
import type { BaseGameState, BaseGameAction, GameRuleset } from "./GameRules";
import type { CloneStrategy } from "./utils/CloneStrategy";
import { StructuredCloneStrategy } from "./utils/CloneStrategy";

export interface PredictiveAction extends BaseGameAction {
  seq?: number;
  tick?: number;
  playerId?: string;
}

export interface PredictiveEngineMetrics {
  /** サーバー確定状態とズレてロールバックが発生した回数 */
  rollbackCount: number;
  /** 未確認のローカルアクション数 */
  pendingActionsCount: number;
  /** 直近のロールバックで再シミュレートしたアクション数 */
  lastRollbackActions: number;
  /** 入力予測による体感レイテンシ短縮推定値（ms） */
  estimatedSavedLatencyMs: number;
  /** 予測誤差が検知された回数 */
  predictionErrorCount: number;
}

export interface ReconcileResult {
  rolledBack: boolean;
  replayedActionsCount: number;
  purgedActionsCount: number;
}

export class PredictiveEngine<
  TState extends BaseGameState,
  TAction extends PredictiveAction,
  TOptions = Record<string, unknown>,
> {
  public readonly localEngine: UniversalEngine<TState, TAction, TOptions>;
  private authoritativeState: TState | null = null;
  private unconfirmedActions: { seq: number; action: TAction; timestamp: number }[] = [];
  private nextSeq: number = 1;
  private cloneStrategy: CloneStrategy<TState>;

  public isPredictionEnabled: boolean = true;
  public artificialLatencyMs: number = 0;

  public metrics: PredictiveEngineMetrics = {
    rollbackCount: 0,
    pendingActionsCount: 0,
    lastRollbackActions: 0,
    estimatedSavedLatencyMs: 0,
    predictionErrorCount: 0,
  };

  constructor(
    rules: GameRuleset<TState, TAction, TOptions>,
    options: TOptions,
    cloneStrategy: CloneStrategy<TState> = new StructuredCloneStrategy(),
  ) {
    this.cloneStrategy = cloneStrategy;
    this.localEngine = new UniversalEngine(rules, options, cloneStrategy);
    this.authoritativeState = this.cloneStrategy.clone(this.localEngine.getState());
  }

  /**
   * 次のシーケンス番号を発行する
   */
  public allocateSeq(): number {
    return this.nextSeq++;
  }

  /**
   * ローカルプレイヤーのアクションを入力予測として即座に適用する
   * @param action 実行するアクション
   * @returns ローカルでのディスパッチ成功可否
   */
  public predictAction(action: TAction): boolean {
    if (action.seq === undefined) {
      action.seq = this.allocateSeq();
    }

    if (!this.isPredictionEnabled) {
      // 予測が無効化されている場合、ローカル状態は進めず、未確認キューにだけ記録する
      this.unconfirmedActions.push({
        seq: action.seq,
        action,
        timestamp: Date.now(),
      });
      this.metrics.pendingActionsCount = this.unconfirmedActions.length;
      return false;
    }

    // 予測が有効な場合：即座にローカルエンジンでディスパッチして状態を進める (0ms 反応)
    const success = this.localEngine.dispatch(action);
    if (success) {
      this.unconfirmedActions.push({
        seq: action.seq,
        action,
        timestamp: Date.now(),
      });
      this.metrics.pendingActionsCount = this.unconfirmedActions.length;
    }
    return success;
  }

  /**
   * サーバーからの確定状態を受け取り、未確認アクションを再シミュレート（ロールバック＆リコンシリエーション）する
   * @param serverState サーバーから届いた確定状態
   * @param lastProcessedSeq サーバーが処理済みの最新ローカルシーケンス番号 (未指定ならキュー全体を対象)
   */
  public reconcile(serverState: TState, lastProcessedSeq?: number): ReconcileResult {
    this.authoritativeState = this.cloneStrategy.clone(serverState);

    // 1. サーバーで処理済みの古いアクションを未確認キューから除去
    let purgedCount = 0;
    if (lastProcessedSeq !== undefined) {
      const initialLen = this.unconfirmedActions.length;
      this.unconfirmedActions = this.unconfirmedActions.filter(
        (item) => item.seq > lastProcessedSeq,
      );
      purgedCount = initialLen - this.unconfirmedActions.length;
    }

    this.metrics.pendingActionsCount = this.unconfirmedActions.length;

    // 予測が無効な場合：確定状態をそのままローカルエンジンに反映
    if (!this.isPredictionEnabled) {
      this.localEngine.loadState(serverState);
      return {
        rolledBack: false,
        replayedActionsCount: 0,
        purgedActionsCount: purgedCount,
      };
    }

    // 2. 確定状態へロールバック
    this.localEngine.loadState(serverState);

    // 3. サーバーで未処理のローカルアクションを再ディスパッチ (Re-simulate / Fast-forward)
    let replayedCount = 0;
    for (const item of this.unconfirmedActions) {
      const ok = this.localEngine.dispatch(item.action);
      if (ok) {
        replayedCount++;
      }
    }

    if (replayedCount > 0 || purgedCount > 0) {
      this.metrics.rollbackCount++;
      this.metrics.lastRollbackActions = replayedCount;
    }

    return {
      rolledBack: true,
      replayedActionsCount: replayedCount,
      purgedActionsCount: purgedCount,
    };
  }

  /**
   * 現在の予測状態を取得
   */
  public getState(): TState {
    return this.localEngine.getState();
  }

  /**
   * サーバー確定状態を取得（ゴースト表示やデバッグ比較用）
   */
  public getAuthoritativeState(): TState | null {
    return this.authoritativeState;
  }

  /**
   * 未確認キューのリセット
   */
  public clearPendingActions(): void {
    this.unconfirmedActions = [];
    this.metrics.pendingActionsCount = 0;
  }

  /**
   * 未確認キューを取得
   */
  public getPendingActions(): readonly { seq: number; action: TAction; timestamp: number }[] {
    return this.unconfirmedActions;
  }
}
