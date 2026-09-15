// Original file: network/game.proto

export interface SimulateRequest {
  gameType?: string;
  stateJson?: string;
  playerId?: string;
  actionId?: number;
}

export interface SimulateRequest__Output {
  gameType: string;
  stateJson: string;
  playerId: string;
  actionId: number;
}
