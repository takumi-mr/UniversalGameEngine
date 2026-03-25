import type { GameRecord, BaseGameState, BaseGameAction } from "../GameRules";

export interface IGameRepository<TState extends BaseGameState> {
  save(gameId: string, state: TState, isFinished?: boolean): Promise<void>;
  load(gameId: string): Promise<TState | null>;
  delete(gameId: string): Promise<void>;

  // Game History (Replay) persistence
  saveGameRecord(gameId: string, record: GameRecord<TState, BaseGameAction>): Promise<void>;
  loadGameRecord(gameId: string): Promise<GameRecord<TState, BaseGameAction> | null>;
}
