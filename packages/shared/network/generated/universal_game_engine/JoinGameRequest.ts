// Original file: network/game.proto


export interface JoinGameRequest {
  'gameId'?: (string);
  'asSpectator'?: (boolean);
  'userToken'?: (string);
}

export interface JoinGameRequest__Output {
  'gameId': (string);
  'asSpectator': (boolean);
  'userToken': (string);
}
