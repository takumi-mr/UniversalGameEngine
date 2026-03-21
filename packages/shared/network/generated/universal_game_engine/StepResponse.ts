// Original file: network/game.proto

export interface StepResponse {
  nextStateTensor?: (number | string)[];
  legalActionIds?: number[];
  reward?: number | string;
  isFinished?: boolean;
  activePlayers?: string[];
}

export interface StepResponse__Output {
  nextStateTensor: number[];
  legalActionIds: number[];
  reward: number;
  isFinished: boolean;
  activePlayers: string[];
}
