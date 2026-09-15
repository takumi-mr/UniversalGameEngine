// Original file: network/game.proto

export interface ResetGameRequest {
  gameId?: string;
  playerIds?: string[];
}

export interface ResetGameRequest__Output {
  gameId: string;
  playerIds: string[];
}
