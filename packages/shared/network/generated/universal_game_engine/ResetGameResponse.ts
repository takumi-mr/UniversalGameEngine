// Original file: network/game.proto


export interface ResetGameResponse {
  'initialStateTensor'?: (number | string)[];
  'initialLegalActionIds'?: (number)[];
  'activePlayers'?: (string)[];
}

export interface ResetGameResponse__Output {
  'initialStateTensor': (number)[];
  'initialLegalActionIds': (number)[];
  'activePlayers': (string)[];
}
