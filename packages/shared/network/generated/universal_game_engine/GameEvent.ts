// Original file: network/game.proto

import type { JoinSuccess as _universal_game_engine_JoinSuccess, JoinSuccess__Output as _universal_game_engine_JoinSuccess__Output } from '../universal_game_engine/JoinSuccess';
import type { GameStateUpdate as _universal_game_engine_GameStateUpdate, GameStateUpdate__Output as _universal_game_engine_GameStateUpdate__Output } from '../universal_game_engine/GameStateUpdate';
import type { ChatMessage as _universal_game_engine_ChatMessage, ChatMessage__Output as _universal_game_engine_ChatMessage__Output } from '../universal_game_engine/ChatMessage';

export interface GameEvent {
  'joined'?: (_universal_game_engine_JoinSuccess | null);
  'stateUpdate'?: (_universal_game_engine_GameStateUpdate | null);
  'chatMessage'?: (_universal_game_engine_ChatMessage | null);
  'errorMessage'?: (string);
  'event'?: "joined"|"stateUpdate"|"chatMessage"|"errorMessage";
}

export interface GameEvent__Output {
  'joined'?: (_universal_game_engine_JoinSuccess__Output | null);
  'stateUpdate'?: (_universal_game_engine_GameStateUpdate__Output | null);
  'chatMessage'?: (_universal_game_engine_ChatMessage__Output | null);
  'errorMessage'?: (string);
  'event'?: "joined"|"stateUpdate"|"chatMessage"|"errorMessage";
}
