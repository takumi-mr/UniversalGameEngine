import type { BaseGameState, BaseGameAction, GameRuleset, GameRecord } from "./GameRules";
import { UniversalEngine } from "./UniversalEngine";
import { calculateStateHash } from "./utils/hash";

export class ReplayEngine<
  TState extends BaseGameState,
  TAction extends BaseGameAction,
  TOptions = Record<string, unknown>,
> {
  private engine: UniversalEngine<TState, TAction, TOptions>;
  private rules: GameRuleset<TState, TAction, TOptions>;

  constructor(rules: GameRuleset<TState, TAction, TOptions>, record: GameRecord<TState, TAction>) {
    this.rules = rules;

    // 初期状態のRNG設定を確認
    const options = {
      clientSeed: record.clientSeed,
      serverSeed: record.finalServerSeed, // 公開されている場合のみ完全再現可能
      ...((record.initialState as any).options || {}), // オプションが保存されている場合
    } as TOptions;

    this.engine = new UniversalEngine(rules, options);

    // スナップショットがあれば、初期状態ではなくそこから開始する
    if (record.snapshotState) {
      this.engine.loadState(record.snapshotState, []);
      // スナップショット時点でのハッシュ検証
      if (record.stateHashes && record.stateHashes.length > 0) {
        const currentHash = calculateStateHash(this.engine.getState());
        const expectedHash = record.stateHashes[0];
        if (currentHash !== expectedHash) {
          throw new Error(
            `Snapshot state hash mismatch at version ${record.snapshotVersion}. Expected ${expectedHash}, got ${currentHash}`,
          );
        }
      }
    } else {
      // 初期状態を強制的に上書き（シードから生成された初期状態がrecord.initialStateと一致することを確認するため）
      const initialHash = calculateStateHash(record.initialState);
      const generatedInitialHash = calculateStateHash(this.engine.getState());

      if (initialHash !== generatedInitialHash) {
        console.warn("Initial state hash mismatch! Checking if manual load is needed.");
        this.engine.loadState(record.initialState);
      }
    }
  }

  /**
   * 記録されたアクションを順次実行し、各ステップでハッシュを検証する
   * @returns 検証結果（成功した場合はtrue、途中で不正を検知した場合はエラーを投げる）
   */
  public verify(record: GameRecord<TState, TAction>): boolean {
    const { actions, stateHashes } = record;

    // 開始時点のハッシュ検証
    if (stateHashes && stateHashes.length > 0) {
      const currentHash = calculateStateHash(this.engine.getState());
      if (currentHash !== stateHashes[0]) {
        throw new Error(
          `Hash mismatch at start of record. Expected ${stateHashes[0]}, got ${currentHash}`,
        );
      }
    }

    // 各アクションを適用して検証
    for (let i = 0; i < actions.length; i++) {
      const action = actions[i];
      const success = this.engine.dispatch(action);

      if (!success) {
        throw new Error(`Failed to dispatch action at step ${i + 1}: ${JSON.stringify(action)}`);
      }

      // record内のhashesは、record開始時点の状態(index 0)からの相対的な履歴であると想定
      if (stateHashes && stateHashes[i + 1]) {
        const currentHash = calculateStateHash(this.engine.getState());
        if (currentHash !== stateHashes[i + 1]) {
          const globalVersion = (record.snapshotVersion || 0) + i + 1;
          throw new Error(
            `Hash mismatch at version ${globalVersion}. Expected ${stateHashes[i + 1]}, got ${currentHash}`,
          );
        }
      }
    }

    return true;
  }

  public getState(): TState {
    return this.engine.getState();
  }
}
