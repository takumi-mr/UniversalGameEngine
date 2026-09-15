// Original file: network/game.proto

import type {
  SimulateRequest as _universal_game_engine_SimulateRequest,
  SimulateRequest__Output as _universal_game_engine_SimulateRequest__Output,
} from "../universal_game_engine/SimulateRequest";

export interface BatchSimulateRequest {
  items?: _universal_game_engine_SimulateRequest[];
}

export interface BatchSimulateRequest__Output {
  items: _universal_game_engine_SimulateRequest__Output[];
}
