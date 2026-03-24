// packages/shared/UniversalEngine.ts
import { isSecret } from "./GameRules";
import type { BaseGameState, BaseGameAction, GameRuleset, GameRecord } from "./GameRules";
import { ProvablyFairRNG } from "./utils/ProvablyFairRNG";
import { sha256, generateRandomSeed } from "./utils/crypto";
import type { IGameRNG } from "./utils/IGameRNG";
import { calculateStateHash } from "./utils/hash";

interface InternalGameState extends BaseGameState {
  prngSecret?: string;
}

// --- 2. 汎用エンジン本体 ---
export class UniversalEngine<
  TState extends BaseGameState,
  TAction extends BaseGameAction,
  TOptions = Record<string, unknown>,
> {
  private state: TState & InternalGameState;
  private rules: GameRuleset<TState, TAction, TOptions>;
  public history: TAction[] = [];
  public readonly options: TOptions;
  private initialState: TState;
  private stateHashes: string[] = [];

  constructor(rules: GameRuleset<TState, TAction, TOptions>, options: TOptions) {
    this.rules = rules;
    this.options = options;

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
    this.initialState = JSON.parse(JSON.stringify(this.state));
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
      this.state.prngConfig.nonce = rng.getNonce();
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
    // 1. 合法手チェック
    if (!this.rules.isValidAction(this.state, action)) {
      return false;
    }

    // RNGインスタンスの作成
    const rng = this.createRNGInstance();

    // 2. 状態の更新 (Reducerパターン: 副作用を持たせず新しい状態を生成)
    this.state = this.rules.reduce(this.state, action, rng);

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
    const currentHash = calculateStateHash(this.state);
    this.state.hash = currentHash;
    this.stateHashes.push(currentHash);

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
    };
  }

  /**
   * 特定のプレイヤーが現在実行可能な合法手一覧を取得する機能（AIやUI補助用）
   */
  public getLegalActions(playerId: string): TAction[] {
    return this.rules.getLegalActions(this.state, playerId);
  }
}
