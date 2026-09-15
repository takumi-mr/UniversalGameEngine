// Original file: network/game.proto

import type {
  SimulateResponse as _universal_game_engine_SimulateResponse,
  SimulateResponse__Output as _universal_game_engine_SimulateResponse__Output,
} from "../universal_game_engine/SimulateResponse";

export interface BatchSimulateResponse {
  items?: _universal_game_engine_SimulateResponse[];
}

export interface BatchSimulateResponse__Output {
  items: _universal_game_engine_SimulateResponse__Output[];
}
