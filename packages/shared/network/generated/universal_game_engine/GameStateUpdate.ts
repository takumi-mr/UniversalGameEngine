// Original file: network/game.proto

import type { GameMetadata as _universal_game_engine_GameMetadata, GameMetadata__Output as _universal_game_engine_GameMetadata__Output } from '../universal_game_engine/GameMetadata';

export interface GameStateUpdate {
  'stateJson'?: (string);
  'metadata'?: (_universal_game_engine_GameMetadata | null);
  'stateTensor'?: (number | string)[];
  'legalActionIds'?: (number)[];
  'rewards'?: ({[key: string]: number | string});
  'isFinished'?: (boolean);
}

export interface GameStateUpdate__Output {
  'stateJson': (string);
  'metadata': (_universal_game_engine_GameMetadata__Output | null);
  'stateTensor': (number)[];
  'legalActionIds': (number)[];
  'rewards': ({[key: string]: number});
  'isFinished': (boolean);
}
