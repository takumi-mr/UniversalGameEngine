// Original file: network/game.proto

export interface WaitForTurnResponse {
  stateTensor?: (number | string)[];
  legalActionIds?: number[];
  stateJson?: string;
}

export interface WaitForTurnResponse__Output {
  stateTensor: number[];
  legalActionIds: number[];
  stateJson: string;
}
