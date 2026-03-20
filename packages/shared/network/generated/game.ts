import type * as grpc from '@grpc/grpc-js';
import type { MessageTypeDefinition } from '@grpc/proto-loader';

import type { GameServiceClient as _universal_game_engine_GameServiceClient, GameServiceDefinition as _universal_game_engine_GameServiceDefinition } from './universal_game_engine/GameService';

type SubtypeConstructor<Constructor extends new (...args: any) => any, Subtype> = {
  new(...args: ConstructorParameters<Constructor>): Subtype;
};

export interface ProtoGrpcType {
  universal_game_engine: {
    ChatMessage: MessageTypeDefinition
    CommonResponse: MessageTypeDefinition
    CreateGameRequest: MessageTypeDefinition
    CreateGameResponse: MessageTypeDefinition
    DispatchActionRequest: MessageTypeDefinition
    GameAction: MessageTypeDefinition
    GameEvent: MessageTypeDefinition
    GameMetadata: MessageTypeDefinition
    GameService: SubtypeConstructor<typeof grpc.Client, _universal_game_engine_GameServiceClient> & { service: _universal_game_engine_GameServiceDefinition }
    GameStateUpdate: MessageTypeDefinition
    JoinGameRequest: MessageTypeDefinition
    JoinSuccess: MessageTypeDefinition
    ResetGameRequest: MessageTypeDefinition
    ResetGameResponse: MessageTypeDefinition
    StepRequest: MessageTypeDefinition
    StepResponse: MessageTypeDefinition
  }
}

