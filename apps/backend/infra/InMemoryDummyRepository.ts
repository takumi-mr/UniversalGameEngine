// apps/backend/infra/InMemoryDummyRepository.ts
import type { IGameRepository } from "@engine/shared/stores/repository";
import type { GameRecord, BaseGameState, BaseGameAction } from "@engine/shared/GameRules";

/**
 * 強化学習（RL）などの高速シミュレーション専用のダミーリポジトリ。
 * 外部DB（Redis/MongoDB）へのアクセスを一切行わず、すべての save/load をスキップまたはメモリ内で処理する。
 */
export class InMemoryDummyRepository<
  TState extends BaseGameState,
> implements IGameRepository<TState> {
  // メモリ内で状態を保持するためのシンプルなMap（必要に応じて）
  private store = new Map<string, TState>();
  private sessionStore = new Map<string, { type: string; state: TState }>();

  async save(gameId: string, state: TState, isFinished = false): Promise<void> {
    this.store.set(gameId, state);
    if (isFinished) {
      this.store.delete(gameId); // 終わったら即破棄してメモリリークを防ぐ
    }
  }

  async load(gameId: string): Promise<TState | null> {
    return this.store.get(gameId) || null;
  }

  async delete(gameId: string): Promise<void> {
    this.store.delete(gameId);
  }

  async saveSession(
    gameId: string,
    type: string,
    state: TState,
    isFinished = false,
  ): Promise<void> {
    this.sessionStore.set(gameId, { type, state });
    if (isFinished) {
      this.sessionStore.delete(gameId);
    }
  }

  async loadSession(gameId: string): Promise<{ type: string; state: TState } | null> {
    return this.sessionStore.get(gameId) || null;
  }

  async deleteSession(gameId: string): Promise<void> {
    this.sessionStore.delete(gameId);
    this.store.delete(gameId);
  }

  async close(): Promise<void> {
    // 閉じるべきコネクションはない
  }

  // --- RL学習時はリプレイを保存しないので何もしない ---
  async saveGameRecord(
    _gameId: string,
    _record: GameRecord<TState, BaseGameAction>,
  ): Promise<void> {
    // No-op
  }

  async loadGameRecord(_gameId: string): Promise<GameRecord<TState, BaseGameAction> | null> {
    return null;
  }

  async appendGameRecord(
    _gameId: string,
    _record: Partial<GameRecord<TState, BaseGameAction>>,
  ): Promise<void> {
    // No-op
  }
}
