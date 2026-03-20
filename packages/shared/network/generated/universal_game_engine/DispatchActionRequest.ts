// Original file: network/game.proto

import type { GameAction as _universal_game_engine_GameAction, GameAction__Output as _universal_game_engine_GameAction__Output } from '../universal_game_engine/GameAction';

export interface DispatchActionRequest {
  'gameId'?: (string);
  'action'?: (_universal_game_engine_GameAction | null);
}

export interface DispatchActionRequest__Output {
  'gameId': (string);
  'action': (_universal_game_engine_GameAction__Output | null);
}
