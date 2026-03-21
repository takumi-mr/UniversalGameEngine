// Original file: network/game.proto


export interface SubmitTurnRequest {
  'gameId'?: (string);
  'playerId'?: (string);
  'actionId'?: (number);
}

export interface SubmitTurnRequest__Output {
  'gameId': (string);
  'playerId': (string);
  'actionId': (number);
}
