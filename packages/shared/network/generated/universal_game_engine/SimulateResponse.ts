// Original file: network/game.proto

export interface SimulateResponse {
  stateJson?: string;
  stateTensor?: (number | string)[];
  legalActionIds?: number[];
  reward?: number | string;
  isFinished?: boolean;
  activePlayers?: string[];
  error?: string;
}

export interface SimulateResponse__Output {
  stateJson: string;
  stateTensor: number[];
  legalActionIds: number[];
  reward: number;
  isFinished: boolean;
  activePlayers: string[];
  error: string;
}
