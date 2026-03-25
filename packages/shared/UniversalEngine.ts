import { deepFreeze } from "./utils/freeze";
import { isSecret, SYSTEM_ACTION_TYPE } from "./GameRules";
import type {
  BaseGameState,
  BaseGameAction,
  GameRuleset,
  GameRecord,
  TickResult,
  ScheduledTask,
} from "./GameRules";
import { ProvablyFairRNG } from "./utils/ProvablyFairRNG";
import { sha256, generateRandomSeed } from "./utils/crypto";
import type { IGameRNG } from "./utils/IGameRNG";
import { calculateStateHash } from "./utils/hash";
import { type CloneStrategy, StructuredCloneStrategy } from "./utils/CloneStrategy";

interface InternalGameState extends BaseGameState {
  prngSecret?: string;
}

export interface UniversalEngineOptions {
  autoHash?: boolean;
  hashInterval?: number;
  maxHistorySize?: number;
  // 固定シミュレーション間隔（ミリ秒）。 tick() のデフォルトDT
  tickInterval?: number;
}

// --- 2. 汎用エンジン本体 ---
export class UniversalEngine<
  TState extends BaseGameState,
  TAction extends BaseGameAction,
  TOptions = Record<string, unknown> & UniversalEngineOptions,
> {
  private state: TState & InternalGameState;
  private rules: GameRuleset<TState, TAction, TOptions>;
  public history: TAction[] = [];
  public readonly options: TOptions;
  private initialState: TState;
  private stateHashes: string[] = [];
  private cloneStrategy: CloneStrategy<TState>;

  private snapshotState?: TState;
  private snapshotVersion: number = 0;
  private engineOptions: UniversalEngineOptions;

  constructor(
    rules: GameRuleset<TState, TAction, TOptions>,
    options: TOptions,
    cloneStrategy: CloneStrategy<TState> = new StructuredCloneStrategy(),
  ) {
    this.rules = rules;
    this.options = options;
    this.cloneStrategy = cloneStrategy;
    this.engineOptions = options as unknown as UniversalEngineOptions;

    const opt = options as Record<string, unknown>;
    const clientSeed = typeof opt.clientSeed === "string" ? opt.clientSeed : undefined;
    const serverSeed = typeof opt.serverSeed === "string" ? opt.serverSeed : undefined;

    // 1. RNGの準備
    let rng: IGameRNG | undefined;
    let initialPrngConfig: BaseGameState["prngConfig"] | undefined;
    let initialPrngSecret: string | undefined;

    if (clientSeed) {
      // サーバーシードがない場合はランダム生成（通常時）、ある場合はそれを使用（テスト・再現時）
      const sSeed = serverSeed || generateRandomSeed();
      const sSeedHash = sha256(sSeed);

      initialPrngConfig = {
        serverSeedHash: sSeedHash,
        clientSeed,
        nonce: 0,
      };
      initialPrngSecret = sSeed;

      rng = new ProvablyFairRNG(sSeed, clientSeed, 0);
    }

    // 2. 初期状態の生成
    this.state = this.rules.getInitialState(options, rng);

    // 3. PRNG設定を状態に反映
    if (initialPrngConfig) {
      this.state.prngConfig = initialPrngConfig;
      this.state.prngSecret = initialPrngSecret;
    }

    // nonceを同期（getInitialState内で乱数が使われた場合）
    if (rng instanceof ProvablyFairRNG) {
      this.updateStateNonce(rng);
    }

    if (this.state.version === undefined) {
      this.state.version = 0;
    }

    // 初期状態をディープコピーして保存
    this.initialState = this.cloneStrategy.clone(this.state);

    // 初期状態のハッシュを記録
    this.stateHashes.push(calculateStateHash(this.state));
  }

  /**
   * Provably Fair PRNGをセットアップする（サーバー側で途中から初期化する場合などに使用）
   */
  public setupPRNG(clientSeed: string, serverSeed?: string): void {
    const sSeed = serverSeed || generateRandomSeed();
    const serverSeedHash = sha256(sSeed);

    this.state.prngConfig = {
      serverSeedHash,
      clientSeed,
      nonce: 0,
    };

    // サーバーシードは Secret として保存
    this.state.prngSecret = sSeed;
  }

  private createRNGInstance(): IGameRNG {
    const secret = this.state.prngSecret || "fallback_secret";
    const config = this.state.prngConfig || {
      serverSeedHash: "",
      clientSeed: "fallback_client",
      nonce: 0,
    };
    return new ProvablyFairRNG(secret, config.clientSeed, config.nonce);
  }

  private updateStateNonce(rng: IGameRNG): void {
    if (this.state.prngConfig && rng instanceof ProvablyFairRNG) {
      this.state = {
        ...this.state,
        prngConfig: {
          ...this.state.prngConfig,
          nonce: rng.getNonce(),
        },
      };
    }
  }

  /**
   * DBなどから取得した外部の状態をエンジンにセットする
   * @param savedState 保存されていた状態
   * @param history 任意：保存されていたアクション履歴
   */
  public loadState(savedState: TState, history: TAction[] = []): void {
    this.state = savedState;
    this.history = history;

    // バージョンが不明な場合は 0 とみなす
    if (this.state.version === undefined) {
      this.state.version = 0;
    }

    // スナップショットがあれば同期させる
    this.snapshotVersion = this.state.version - this.history.length;
  }

  /**
   * 手動で状態ハッシュを計算し、現在の状態にセットする
   */
  public computeHash(): string {
    const hash = calculateStateHash(this.state);
    this.state.hash = hash;
    this.stateHashes.push(hash);
    return hash;
  }

  /**
   * 現在の状態をスナップショットとして保存し、古い履歴をパージする準備をする
   */
  public takeSnapshot(): void {
    this.snapshotState = this.cloneStrategy.clone(this.state);
    this.snapshotVersion = this.state.version ?? 0;
    // メモリ解放のために履歴とハッシュ履歴をクリア
    this.history = [];
    this.stateHashes = [calculateStateHash(this.state)]; // スナップショット時点のハッシュから再開
  }

  /**
   * 外部（リポジトリ等）への保存が完了した後に、蓄積された履歴をクリアする
   */
  public flushHistory(): void {
    const currentVersion = this.state.version ?? 0;
    // スナップショットが未取得なら現時点の状態をスナップショットとする
    if (this.snapshotVersion < currentVersion) {
      this.takeSnapshot();
    }
  }

  public getState(): TState {
    return this.state;
  }

  /**
   * 隠匿情報（相手の手札や裏向きのカード）など、
   * 特定のプレイヤーに送信するべきではない情報をマスクした状態を返す
   * @param playerId マスク処理の対象となるプレイヤーID
   */
  public getMaskedState(playerId: string): TState {
    // 1. Secret 型を用いた自動マスク処理
    let maskedState = this.autoMask(this.state, playerId) as TState;

    // 2. 既存のルールセット固有のマスク処理があれば適用 (互換性維持)
    if (this.rules.maskState) {
      maskedState = this.rules.maskState(maskedState, playerId);
    }
    return maskedState;
  }

  /**
   * オブジェクト内を再帰的に走査し、Secret型を見つけたら閲覧権限に応じてマスクする
   */
  private autoMask(obj: unknown, playerId: string): unknown {
    if (obj === null || typeof obj !== "object") {
      return obj;
    }

    // Secret型の処理
    if (isSecret(obj)) {
      const isVisible = obj.visibleTo.includes("*") || obj.visibleTo.includes(playerId);
      if (isVisible) {
        // 閲覧権限がある場合は中身を展開（再帰的にさらにマスクが必要か確認）
        return this.autoMask(obj.value, playerId);
      } else {
        // 権限がない場合はマスク値（デフォルト "?"）を返す
        return obj.maskedValue !== undefined ? obj.maskedValue : "?";
      }
    }

    // 配列の処理
    if (Array.isArray(obj)) {
      return obj.map((item) => this.autoMask(item, playerId));
    }

    // Record<string, unknown> として安全に処理
    const result: Record<string, unknown> = {};
    const record = obj as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      result[key] = this.autoMask(record[key], playerId);
    }
    return result;
  }

  // クライアントからの通信を受け取る汎用エンドポイント
  public dispatch(action: TAction): boolean {
    // 1. 合法手チェック（システムアクションはバイパス）
    const isSystemAction = action.type && action.type.startsWith("@system/");
    if (!isSystemAction && !this.rules.isValidAction(this.state, action)) {
      return false;
    }

    // RNGインスタンスの作成
    const rng = this.createRNGInstance();

    // 2. 状態の更新 (Reducerパターン: 副作用を持たせず新しい状態を生成)
    const base = this.cloneStrategy.clone(this.state);

    // 開発/テスト環境では、reduce内で状態が変更されないよう凍結する
    if (process.env.NODE_ENV !== "production") {
      deepFreeze(base);
    }

    // システムアクションの処理
    let nextState = this.handleSystemAction(base as TState & InternalGameState, action, rng);

    // ゲームルールの適用
    if (action.type && !action.type.startsWith("@system/")) {
      nextState = this.rules.reduce(nextState, action, rng) as TState & InternalGameState;
    }

    this.state = nextState;

    // nonceを同期
    if (rng) {
      this.updateStateNonce(rng);
    }

    this.history.push(action);

    // 3. 勝敗判定
    const winCheck = this.rules.checkWinCondition(this.state);
    if (winCheck.isFinished) {
      // applyWinResult がある場合はルールセットに委任（スコア精算等）
      if (this.rules.applyWinResult) {
        this.state = this.rules.applyWinResult(this.state, winCheck);
      } else {
        // デフォルト: status と message だけ更新
        this.state = {
          ...this.state,
          status: "FINISHED",
          message: winCheck.message,
        };
      }
      console.log("Game Finished!", this.state.message);
    }

    // 3.5 状態のバージョンをインクリメント
    this.state.version = (this.state.version ?? 0) + 1;

    // 3.6 状態のハッシュを計算して記録
    const interval = this.engineOptions.hashInterval ?? 1;
    const shouldHash =
      (this.engineOptions.autoHash !== false && this.state.version! % interval === 0) ||
      this.state.status === "FINISHED";

    if (shouldHash) {
      this.computeHash();
    }

    if (
      this.engineOptions.maxHistorySize !== undefined &&
      this.history.length >= this.engineOptions.maxHistorySize
    ) {
      this.takeSnapshot();
    }

    return true;
  }

  /**
   * 時間経過またはシミュレーションの1ステップを進める
   * @param dt 経過時間（ミリ秒）。未指定の場合は engineOptions.tickInterval (デフォルト 16ms) を使用
   * @returns 処理が実行された場合は true
   */
  public tick(dt?: number): boolean {
    // 1. 時刻を進める（決定性のために固定DTを優先）
    const interval = dt ?? this.engineOptions.tickInterval ?? 16;
    const currentTime = (this.state.currentTime ?? 0) + interval;

    // Immutableに時刻とタスクリストを更新（一時的な状態）
    let nextState = {
      ...this.state,
      currentTime,
    } as TState & InternalGameState;

    const pendingActions: TAction[] = [];

    // 2. スケジュールされたタスクのチェック
    if (nextState.scheduledTasks && nextState.scheduledTasks.length > 0) {
      const remainingTasks: ScheduledTask<TAction>[] = [];
      for (const task of nextState.scheduledTasks) {
        if (task.dueTime <= currentTime) {
          pendingActions.push(task.action as TAction);
          if (task.interval) {
            remainingTasks.push({
              ...(task as any),
              dueTime: task.dueTime + task.interval,
            });
          }
        } else {
          remainingTasks.push(task as ScheduledTask<TAction>);
        }
      }
      nextState.scheduledTasks = remainingTasks;
    }

    // 3. ルールのtick実行 (オプショナル)
    if (this.rules.tick) {
      const rng = this.createRNGInstance();
      let result: TState | TickResult<TState, TAction>;

      if (this.rules.tickMode === "mutable") {
        result = this.rules.tick(nextState, interval, rng);
      } else {
        const base = this.cloneStrategy.clone(nextState);
        if (process.env.NODE_ENV !== "production") {
          deepFreeze(base);
        }
        result = this.rules.tick(base, interval, rng);
      }

      // 結果の正規化
      if (result && typeof result === "object" && "state" in result) {
        nextState = result.state as TState & InternalGameState;
        if (result.pendingActions) {
          pendingActions.push(...result.pendingActions);
        }
      } else {
        nextState = result as TState & InternalGameState;
      }
    }

    // 4. 状態の反映
    this.state = nextState;

    // 5. キューイングされたアクションの実行
    // tick中の再帰的なdispatchを避けるため、ここでまとめて実行
    for (const action of pendingActions) {
      this.dispatch(action);
    }

    // 状態が変更されたとみなしてバージョンを上げる（時刻が進んでいるため）
    // もし dispatch が呼ばれていれば、すでに dispatch 内で上げられているが、
    // ここでも念押しで整合性をとる（dispatchが複数回呼ばれても version は最終的にユニークになる）
    this.state = {
      ...this.state,
      version: (this.state.version ?? 0) + 1,
    };

    // ハッシュ計算
    const hashInterval = this.engineOptions.hashInterval ?? 10;
    if (this.engineOptions.autoHash !== false && this.state.version! % hashInterval === 0) {
      this.computeHash();
    }

    return true;
  }

  /**
   * アクションを将来の指定時刻にスケジュールする。
   * 内部的にはシステムアクションとして dispatch され、履歴に残る。
   * @param action 実行するアクション
   * @param delayMillis 現在時刻からの遅延（ミリ秒）
   * @param intervalMillis 定期実行する場合の間隔（ミリ秒）
   */
  public schedule(action: TAction, delayMillis: number, intervalMillis?: number): void {
    const systemAction = {
      type: (SYSTEM_ACTION_TYPE as any).SCHEDULE_TASK,
      payload: {
        action,
        delayMillis,
        intervalMillis,
      },
    } as unknown as TAction;

    this.dispatch(systemAction);
  }

  /**
   * システムアクションの処理
   */
  private handleSystemAction(
    state: TState & InternalGameState,
    action: TAction,
    rng: IGameRNG,
  ): TState & InternalGameState {
    const a = action as any;
    if (a.type === (SYSTEM_ACTION_TYPE as any).SCHEDULE_TASK) {
      const { action: taskAction, delayMillis, intervalMillis } = a.payload;
      // 決定論的なID生成
      const id = `task_${state.version ?? 0}_${state.currentTime ?? 0}_${Math.floor(rng.nextFloat() * 1000000)}`;
      const dueTime = (state.currentTime ?? 0) + delayMillis;

      return {
        ...state,
        scheduledTasks: [
          ...(state.scheduledTasks ?? []),
          { id, action: taskAction, dueTime, interval: intervalMillis },
        ],
      };
    }
    return state;
  }

  /**
   * 指定されたステップ数だけシミュレーションを進める（テストや検証用）
   * @param cycles ステップ数
   * @param dt 各ステップの経過時間
   */
  public runSimulation(cycles: number, dt: number = 0): void {
    for (let i = 0; i < cycles; i++) {
      this.tick(dt);
    }
  }

  /**
   * 現在のゲームセッションをGameRecord形式で出力する
   */
  public getGameRecord(gameId: string): GameRecord<TState, TAction> {
    return {
      gameId,
      initialState: this.initialState,
      actions: [...this.history],
      serverSeedHash: this.state.prngConfig?.serverSeedHash || "",
      clientSeed: this.state.prngConfig?.clientSeed || "",
      finalServerSeed: this.state.status === "FINISHED" ? this.state.prngSecret : undefined,
      stateHashes: [...this.stateHashes],
      snapshotState: this.snapshotState,
      snapshotVersion: this.snapshotVersion > 0 ? this.snapshotVersion : undefined,
    };
  }

  /**
   * 特定のプレイヤーが現在実行可能な合法手一覧を取得する機能（AIやUI補助用）
   */
  public getLegalActions(playerId: string): TAction[] {
    return this.rules.getLegalActions(this.state, playerId);
  }
}
