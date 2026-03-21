// Original file: network/game.proto

export interface StepRequest {
  gameId?: string;
  playerId?: string;
  actionId?: number;
}

export interface StepRequest__Output {
  gameId: string;
  playerId: string;
  actionId: number;
}
