// packages/shared/repository.ts
export interface IGameRepository<TState> {
  save(gameId: string, state: TState, isFinished?: boolean): Promise<void>;
  load(gameId: string): Promise<TState | null>;
  delete(gameId: string): Promise<void>;
}
