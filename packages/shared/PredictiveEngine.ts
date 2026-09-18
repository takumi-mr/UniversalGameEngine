// packages/shared/PredictiveEngine.ts
//
// クライアント側入力予測（Client-Side Prediction）とサーバー確定状態との照合（Reconciliation）。
//
//   predictAction : 自分の入力を即座にローカルで適用し、未確認キューに積む（サーバーにも送る）
//   advanceLocal  : サーバーに送らないローカル専用の進行（時刻駆動のティック等）。キューには積まない
//   reconcile     : サーバー確定状態に巻き戻し、サーバーが未処理の入力を再適用し、
//                   必要なら catchUp で「予測していた時点」まで進め直す。
//                   予測と訂正後が異なっていれば rollback として数える
//
// エンジン（reduce）は決定論なので、同じ timestamp を持つ入力を同じ状態に再適用すれば同じ結果になる。
import { UniversalEngine } from "@engine/shared/UniversalEngine";
import type { BaseGameState, BaseGameAction, GameRuleset } from "@engine/shared/GameRules";
import type { CloneStrategy } from "@engine/shared/utils/CloneStrategy";
import { StructuredCloneStrategy } from "@engine/shared/utils/CloneStrategy";
import { calculateStateHash } from "@engine/shared/utils/hash";

export interface PredictiveAction extends BaseGameAction {
  seq?: number;
}

export interface PredictiveEngineMetrics {
  /** 訂正後の状態が予測と異なっていた reconcile の回数（＝目に見える補正） */
  rollbackCount: number;
  /** reconcile の回数 */
  reconcileCount: number;
  /** 未確認のローカルアクション数 */
  pendingActionsCount: number;
  /** 直近の reconcile で再適用したアクション数 */
  lastRollbackActions: number;
}

export interface ReconcileResult {
  rolledBack: boolean;
  replayedActionsCount: number;
  purgedActionsCount: number;
  /** 訂正後の状態が予測と異なっていたか */
  corrected: boolean;
}

export interface ReconcileOptions<TState, TAction> {
  /**
   * 再適用の後に、予測していた時点（predicted）まで進め直すためのアクションを返す。
   * 時刻駆動のゲームでは「predicted.tick まで進める TICK」を返す。null なら何もしない
   */
  catchUp?: (predicted: TState) => TAction | null;
}

/** 比較から外す、サーバーとローカルで当然異なるメタ情報 */
const VOLATILE_KEYS = ["version", "hash", "prngConfig", "prngSecret"];

function comparableHash(state: BaseGameState): string {
  const copy: Record<string, unknown> = { ...state };
  for (const k of VOLATILE_KEYS) delete copy[k];
  return calculateStateHash(copy);
}

export class PredictiveEngine<
  TState extends BaseGameState,
  TAction extends PredictiveAction,
  TOptions = Record<string, unknown>,
> {
  public readonly localEngine: UniversalEngine<TState, TAction, TOptions>;
  private authoritativeState: TState | null = null;
  private unconfirmedActions: { seq: number; action: TAction; timestamp: number }[] = [];
  private nextSeq = 1;
  private synced = false;
  private readonly cloneStrategy: CloneStrategy<TState>;

  public isPredictionEnabled = true;

  public metrics: PredictiveEngineMetrics = {
    rollbackCount: 0,
    reconcileCount: 0,
    pendingActionsCount: 0,
    lastRollbackActions: 0,
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

  public allocateSeq(): number {
    return this.nextSeq++;
  }

  /**
   * 自分の入力を予測として即座に適用し、未確認キューに積む。
   * 予測が無効なら適用せずキューにだけ積む（サーバーの確定を待つ）
   */
  public predictAction(action: TAction): boolean {
    if (action.seq === undefined) action.seq = this.allocateSeq();
    const entry = { seq: action.seq, action, timestamp: Date.now() };

    if (!this.isPredictionEnabled) {
      this.unconfirmedActions.push(entry);
      this.metrics.pendingActionsCount = this.unconfirmedActions.length;
      return false;
    }

    const success = this.localEngine.dispatch(action);
    if (success) {
      this.unconfirmedActions.push(entry);
      this.metrics.pendingActionsCount = this.unconfirmedActions.length;
    }
    return success;
  }

  /**
   * サーバーに送らないローカル専用の進行（時刻駆動のティックなど）。
   * 未確認キューには積まない。reconcile 後は catchUp で同じ時点まで進め直す
   */
  public advanceLocal(action: TAction): boolean {
    if (!this.isPredictionEnabled) return false;
    return this.localEngine.dispatch(action);
  }

  /**
   * サーバーの確定状態を取り込む。
   * @param serverState サーバーから届いた確定状態
   * @param lastProcessedSeq サーバーが処理済みの自分の最新 seq（これ以下の未確認アクションは捨てる）
   */
  public reconcile(
    serverState: TState,
    lastProcessedSeq?: number,
    options: ReconcileOptions<TState, TAction> = {},
  ): ReconcileResult {
    const predicted = this.localEngine.getState();
    this.authoritativeState = this.cloneStrategy.clone(serverState);
    this.metrics.reconcileCount++;

    let purgedCount = 0;
    if (lastProcessedSeq !== undefined) {
      const before = this.unconfirmedActions.length;
      this.unconfirmedActions = this.unconfirmedActions.filter((i) => i.seq > lastProcessedSeq);
      purgedCount = before - this.unconfirmedActions.length;
    }

    if (!this.isPredictionEnabled) {
      this.localEngine.loadState(this.cloneStrategy.clone(serverState));
      this.metrics.pendingActionsCount = this.unconfirmedActions.length;
      this.synced = true;
      return {
        rolledBack: false,
        replayedActionsCount: 0,
        purgedActionsCount: purgedCount,
        corrected: false,
      };
    }

    // 確定状態へ巻き戻し、サーバーが未処理の入力を再適用する。適用できないものは捨てる
    this.localEngine.loadState(this.cloneStrategy.clone(serverState));
    let replayedCount = 0;
    this.unconfirmedActions = this.unconfirmedActions.filter((item) => {
      const ok = this.localEngine.dispatch(item.action);
      if (ok) replayedCount++;
      return ok;
    });
    this.metrics.pendingActionsCount = this.unconfirmedActions.length;
    this.metrics.lastRollbackActions = replayedCount;

    // 予測していた時点まで進め直してから、予測と比較する
    const catchUpAction = options.catchUp?.(predicted);
    if (catchUpAction) this.localEngine.dispatch(catchUpAction);

    // 初回の同期は予測の訂正ではないので数えない
    const corrected =
      this.synced && comparableHash(predicted) !== comparableHash(this.localEngine.getState());
    this.synced = true;
    if (corrected) this.metrics.rollbackCount++;

    return {
      rolledBack: true,
      replayedActionsCount: replayedCount,
      purgedActionsCount: purgedCount,
      corrected,
    };
  }

  public getState(): TState {
    return this.localEngine.getState();
  }

  /** サーバー確定状態（ゴースト表示やデバッグ比較用） */
  public getAuthoritativeState(): TState | null {
    return this.authoritativeState;
  }

  public clearPendingActions(): void {
    this.unconfirmedActions = [];
    this.metrics.pendingActionsCount = 0;
  }

  public getPendingActions(): readonly { seq: number; action: TAction; timestamp: number }[] {
    return this.unconfirmedActions;
  }
}
