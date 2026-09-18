import { deepFreeze } from "@engine/shared/utils/freeze";
import { isSecret } from "@engine/shared/GameRules";
import type {
  BaseGameState,
  BaseGameAction,
  BuiltinAction,
  GameRuleset,
  GameRecord,
} from "@engine/shared/GameRules";
import { ProvablyFairRNG } from "@engine/shared/utils/ProvablyFairRNG";
import { sha256, generateRandomSeed } from "@engine/shared/utils/crypto";
import type { IGameRNG } from "@engine/shared/utils/IGameRNG";
import { calculateStateHash } from "@engine/shared/utils/hash";
import { type CloneStrategy, StructuredCloneStrategy } from "@engine/shared/utils/CloneStrategy";

/** エンジンが状態に追加する内部フィールド（サーバーシード）。テストで参照する場合はこの型にキャストする */
export interface InternalGameState extends BaseGameState {
  prngSecret?: string;
}

export interface UniversalEngineOptions {
  autoHash?: boolean;
  hashInterval?: number;
  maxHistorySize?: number;
}

/**
 * リプレイ（GameRecord）を組み立てるためにエンジンが内部に持つ情報。
 * state と一緒に永続化しておけば、別インスタンスで loadState したエンジンでも
 * 完全な GameRecord を出力できる。
 */
export interface EngineReplayData<TState extends BaseGameState, TAction extends BaseGameAction> {
  initialState: TState;
  history: TAction[];
  stateHashes: string[];
  snapshotState?: TState;
  snapshotVersion: number;
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
    // 1. RNGの準備
    //    シードが指定されなければ自動生成する。これによりエンジンは常に決定論的な RNG を持ち、
    //    シードは状態（prngConfig / prngSecret）に記録されるので、後から同じ展開を再現できる。
    //    ルールセットは rng を必須として扱ってよい（Math.random は使わない）。
    const clientSeed = typeof opt.clientSeed === "string" ? opt.clientSeed : generateRandomSeed();
    // サーバーシードがない場合はランダム生成（通常時）、ある場合はそれを使用（テスト・再現時）
    const serverSeed = typeof opt.serverSeed === "string" ? opt.serverSeed : generateRandomSeed();
    const rng = new ProvablyFairRNG(serverSeed, clientSeed, 0);

    // 2. 初期状態の生成
    this.state = this.rules.getInitialState(options, rng);

    // 3. PRNG設定を状態に反映
    this.state.prngConfig = {
      serverSeedHash: sha256(serverSeed),
      clientSeed,
      nonce: 0,
    };
    this.state.prngSecret = serverSeed;

    // nonceを同期（getInitialState内で乱数が使われた場合）
    this.updateStateNonce(rng);

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

  private createRNGInstance(): IGameRNG | undefined {
    const secret = this.state.prngSecret;
    if (this.state.prngConfig && secret) {
      return new ProvablyFairRNG(
        secret,
        this.state.prngConfig.clientSeed,
        this.state.prngConfig.nonce,
      );
    }
    return undefined;
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
   * @param replay 任意：保存されていたアクション履歴、または getReplayData() で取り出したリプレイ情報一式。
   *   履歴だけを渡した場合、初期状態やハッシュ履歴はこのエンジン生成時のものが残るので
   *   getGameRecord() は不完全になる。インスタンスを跨いで復元するときはリプレイ情報一式を渡すこと。
   */
  public loadState(
    savedState: TState,
    replay: TAction[] | EngineReplayData<TState, TAction> = [],
  ): void {
    this.state = savedState;

    // バージョンが不明な場合は 0 とみなす
    if (this.state.version === undefined) {
      this.state.version = 0;
    }

    if (Array.isArray(replay)) {
      this.history = replay;
      // スナップショットがあれば同期させる
      this.snapshotVersion = this.state.version - this.history.length;
      return;
    }

    this.initialState = replay.initialState;
    this.history = replay.history;
    this.stateHashes = replay.stateHashes;
    this.snapshotState = replay.snapshotState;
    this.snapshotVersion = replay.snapshotVersion;
  }

  /**
   * getGameRecord() に必要な内部情報を取り出す（state と一緒に永続化するため）。
   * 復元は loadState(state, replayData)。
   */
  public getReplayData(): EngineReplayData<TState, TAction> {
    return {
      initialState: this.initialState,
      history: [...this.history],
      stateHashes: [...this.stateHashes],
      snapshotState: this.snapshotState,
      snapshotVersion: this.snapshotVersion,
    };
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
  // 組み込みアクション（JOIN / START / TIMEOUT）はルールセットの TAction に含まれていなくても受け付ける
  public dispatch(input: TAction | BuiltinAction): boolean {
    // 組み込みアクションもルールセットに渡す（受け付けないルールセットは isValidAction で false を返す）
    const action = input as TAction;
    const base = this.cloneStrategy.clone(this.state);

    // 0. 組み込みアクション（着席・開始）
    //    ルールセットに依存しない共通処理。ここを通すことで history / version / hash に記録され、
    //    リプレイで着席から完全に再現できる。
    //    - JOIN : state.players の空席（slot 指定があればその席）に着席させる。
    //             その上でルールセットが JOIN を受け付ければルールセットの reduce も実行する
    //    - START: ルールセットが START を受け付けなければ status を PLAYING にする
    let builtinApplied = false;
    if (action.type === "JOIN" && action.playerId) {
      builtinApplied = this.seatPlayer(base, action.playerId, (action as { slot?: string }).slot);
    }

    // 1. 合法手チェック
    let valid = this.rules.isValidAction(base, action);

    //    TIMEOUT: 制限時間切れ。ルールセットが自前で扱わなければ組み込みで解決する
    //    （getTimeoutAction → RESIGN → 強制終了）。履歴には TIMEOUT 自体が残り、リプレイでも同じ解決になる
    let timeoutResolution: TAction | "FORFEIT" | null = null;
    if (action.type === "TIMEOUT") {
      if (!this.isTimeoutDue(base, action)) return false;
      if (!valid) {
        timeoutResolution = this.resolveTimeout(base, action);
        valid = timeoutResolution !== "FORFEIT";
      }
    }

    if (!valid) {
      if (action.type === "START" && base.status === "WAITING") {
        base.status = "PLAYING";
        builtinApplied = true;
      } else if (timeoutResolution === "FORFEIT") {
        // 時間切れを解決する手段が無い: 手番の側の負けとして終了する
        base.status = "FINISHED";
        base.message = `${action.playerId} timed out`;
        base.activePlayers = [];
      } else if (!builtinApplied) {
        return false;
      }
    }

    // RNGインスタンスの作成
    const rng = this.createRNGInstance();

    // 2. 状態の更新 (Reducerパターン: 副作用を持たせず新しい状態を生成)
    const prev = this.state;
    if (valid) {
      // 開発/テスト環境では、reduce内で状態が変更されないよう凍結する
      if (process.env.NODE_ENV !== "production") {
        deepFreeze(base);
      }
      const applied =
        timeoutResolution && timeoutResolution !== "FORFEIT" ? timeoutResolution : action;
      this.state = this.rules.reduce(base, applied, rng);
    } else {
      this.state = base;
    }

    // START を受け付けたのに WAITING のままなら開始扱いにする
    // （未知のアクションを素通しするルールセットや、status を持たない実装のため）
    if (action.type === "START" && this.state.status === "WAITING") {
      this.state = { ...this.state, status: "PLAYING" };
      builtinApplied = true;
    }

    // RNG 設定はエンジンの管轄。ルールセットが状態を作り直して落としても引き継ぐ
    if (!this.state.prngConfig && prev.prngConfig) {
      this.state = { ...this.state, prngConfig: prev.prngConfig, prngSecret: prev.prngSecret };
    }

    // 開始直後（または進行中のゲームへの着席直後）に手番が未設定なら、合法手を持つプレイヤーを手番にする
    if ((action.type === "START" || builtinApplied) && this.state.status === "PLAYING") {
      this.ensureActivePlayers();
    }

    // nonceを同期
    if (rng) {
      this.updateStateNonce(rng);
    }

    this.history.push(action);

    // 3. 勝敗判定（開始前の着席中には行わない）
    const winCheck =
      this.state.status === "WAITING"
        ? { isFinished: false }
        : this.rules.checkWinCondition(this.state);
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

  /**
   * TIMEOUT が有効か: 対局中で、締切が設定されていて、締切を過ぎた時刻で、手番のプレイヤーに対するもの。
   * 古いタイマーの誤爆（既に手が進んで手番が変わった等）はここで弾かれる
   */
  private isTimeoutDue(state: TState, action: TAction): boolean {
    if (state.status !== "PLAYING") return false;
    if (state.turnDeadline === undefined || action.timestamp === undefined) return false;
    if (action.timestamp < state.turnDeadline) return false;
    return !!action.playerId && !!state.activePlayers?.includes(action.playerId);
  }

  /** TIMEOUT を実際のアクションに解決する: getTimeoutAction → RESIGN → 強制終了 */
  private resolveTimeout(state: TState, action: TAction): TAction | "FORFEIT" {
    const playerId = action.playerId!;
    const stamp = (a: TAction): TAction => ({ ...a, playerId, timestamp: action.timestamp });
    const fromRules = this.rules.getTimeoutAction?.(state, playerId);
    if (fromRules) {
      const candidate = stamp(fromRules);
      if (this.rules.isValidAction(state, candidate)) return candidate;
    }
    const resign = stamp({ type: "RESIGN" } as TAction);
    if (this.rules.isValidAction(state, resign)) return resign;
    return "FORFEIT";
  }

  /**
   * 組み込み JOIN: 空席に着席させる。着席できた場合 true。
   * 既に着席済み・空席なし・指定席が埋まっている・players を持たないゲームでは false。
   */
  private seatPlayer(state: TState, playerId: string, slot?: string): boolean {
    if (!state.players || state.status === "FINISHED") return false;
    if (Object.values(state.players).includes(playerId)) return false;
    const key =
      slot !== undefined
        ? state.players[slot] === null
          ? slot
          : undefined
        : Object.keys(state.players).find((k) => state.players![k] === null);
    if (key === undefined) return false;
    state.players[key] = playerId;
    return true;
  }

  /**
   * activePlayers が空なら、着席中で合法手を持つプレイヤーを手番にする（開始直後用）
   */
  private ensureActivePlayers(): void {
    if (this.state.activePlayers && this.state.activePlayers.length > 0) return;
    const seated = Object.values(this.state.players ?? {}).filter(
      (p): p is string => typeof p === "string",
    );
    const active = seated.filter((pid) => this.rules.getLegalActions(this.state, pid).length > 0);
    // reduce が返した状態は凍結されている可能性があるので、新しいオブジェクトにする
    if (active.length > 0) this.state = { ...this.state, activePlayers: active };
  }
}
