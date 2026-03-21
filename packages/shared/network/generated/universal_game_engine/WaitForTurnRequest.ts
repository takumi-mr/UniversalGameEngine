// Original file: network/game.proto

export interface WaitForTurnRequest {
  gameId?: string;
  playerId?: string;
}

export interface WaitForTurnRequest__Output {
  gameId: string;
  playerId: string;
}
