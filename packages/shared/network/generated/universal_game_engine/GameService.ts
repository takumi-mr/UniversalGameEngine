// Original file: network/game.proto

import type * as grpc from "@grpc/grpc-js";
import type { MethodDefinition } from "@grpc/proto-loader";
import type {
  ChatMessage as _universal_game_engine_ChatMessage,
  ChatMessage__Output as _universal_game_engine_ChatMessage__Output,
} from "../universal_game_engine/ChatMessage";
import type {
  CommonResponse as _universal_game_engine_CommonResponse,
  CommonResponse__Output as _universal_game_engine_CommonResponse__Output,
} from "../universal_game_engine/CommonResponse";
import type {
  CreateGameRequest as _universal_game_engine_CreateGameRequest,
  CreateGameRequest__Output as _universal_game_engine_CreateGameRequest__Output,
} from "../universal_game_engine/CreateGameRequest";
import type {
  CreateGameResponse as _universal_game_engine_CreateGameResponse,
  CreateGameResponse__Output as _universal_game_engine_CreateGameResponse__Output,
} from "../universal_game_engine/CreateGameResponse";
import type {
  DispatchActionRequest as _universal_game_engine_DispatchActionRequest,
  DispatchActionRequest__Output as _universal_game_engine_DispatchActionRequest__Output,
} from "../universal_game_engine/DispatchActionRequest";
import type {
  GameEvent as _universal_game_engine_GameEvent,
  GameEvent__Output as _universal_game_engine_GameEvent__Output,
} from "../universal_game_engine/GameEvent";
import type {
  JoinGameRequest as _universal_game_engine_JoinGameRequest,
  JoinGameRequest__Output as _universal_game_engine_JoinGameRequest__Output,
} from "../universal_game_engine/JoinGameRequest";
import type {
  ResetGameRequest as _universal_game_engine_ResetGameRequest,
  ResetGameRequest__Output as _universal_game_engine_ResetGameRequest__Output,
} from "../universal_game_engine/ResetGameRequest";
import type {
  ResetGameResponse as _universal_game_engine_ResetGameResponse,
  ResetGameResponse__Output as _universal_game_engine_ResetGameResponse__Output,
} from "../universal_game_engine/ResetGameResponse";
import type {
  StepRequest as _universal_game_engine_StepRequest,
  StepRequest__Output as _universal_game_engine_StepRequest__Output,
} from "../universal_game_engine/StepRequest";
import type {
  StepResponse as _universal_game_engine_StepResponse,
  StepResponse__Output as _universal_game_engine_StepResponse__Output,
} from "../universal_game_engine/StepResponse";
import type {
  SubmitTurnRequest as _universal_game_engine_SubmitTurnRequest,
  SubmitTurnRequest__Output as _universal_game_engine_SubmitTurnRequest__Output,
} from "../universal_game_engine/SubmitTurnRequest";
import type {
  WaitForTurnRequest as _universal_game_engine_WaitForTurnRequest,
  WaitForTurnRequest__Output as _universal_game_engine_WaitForTurnRequest__Output,
} from "../universal_game_engine/WaitForTurnRequest";
import type {
  WaitForTurnResponse as _universal_game_engine_WaitForTurnResponse,
  WaitForTurnResponse__Output as _universal_game_engine_WaitForTurnResponse__Output,
} from "../universal_game_engine/WaitForTurnResponse";

export interface GameServiceClient extends grpc.Client {
  CreateGame(
    argument: _universal_game_engine_CreateGameRequest,
    metadata: grpc.Metadata,
    options: grpc.CallOptions,
    callback: grpc.requestCallback<_universal_game_engine_CreateGameResponse__Output>,
  ): grpc.ClientUnaryCall;
  CreateGame(
    argument: _universal_game_engine_CreateGameRequest,
    metadata: grpc.Metadata,
    callback: grpc.requestCallback<_universal_game_engine_CreateGameResponse__Output>,
  ): grpc.ClientUnaryCall;
  CreateGame(
    argument: _universal_game_engine_CreateGameRequest,
    options: grpc.CallOptions,
    callback: grpc.requestCallback<_universal_game_engine_CreateGameResponse__Output>,
  ): grpc.ClientUnaryCall;
  CreateGame(
    argument: _universal_game_engine_CreateGameRequest,
    callback: grpc.requestCallback<_universal_game_engine_CreateGameResponse__Output>,
  ): grpc.ClientUnaryCall;
  createGame(
    argument: _universal_game_engine_CreateGameRequest,
    metadata: grpc.Metadata,
    options: grpc.CallOptions,
    callback: grpc.requestCallback<_universal_game_engine_CreateGameResponse__Output>,
  ): grpc.ClientUnaryCall;
  createGame(
    argument: _universal_game_engine_CreateGameRequest,
    metadata: grpc.Metadata,
    callback: grpc.requestCallback<_universal_game_engine_CreateGameResponse__Output>,
  ): grpc.ClientUnaryCall;
  createGame(
    argument: _universal_game_engine_CreateGameRequest,
    options: grpc.CallOptions,
    callback: grpc.requestCallback<_universal_game_engine_CreateGameResponse__Output>,
  ): grpc.ClientUnaryCall;
  createGame(
    argument: _universal_game_engine_CreateGameRequest,
    callback: grpc.requestCallback<_universal_game_engine_CreateGameResponse__Output>,
  ): grpc.ClientUnaryCall;

  DispatchAction(
    argument: _universal_game_engine_DispatchActionRequest,
    metadata: grpc.Metadata,
    options: grpc.CallOptions,
    callback: grpc.requestCallback<_universal_game_engine_CommonResponse__Output>,
  ): grpc.ClientUnaryCall;
  DispatchAction(
    argument: _universal_game_engine_DispatchActionRequest,
    metadata: grpc.Metadata,
    callback: grpc.requestCallback<_universal_game_engine_CommonResponse__Output>,
  ): grpc.ClientUnaryCall;
  DispatchAction(
    argument: _universal_game_engine_DispatchActionRequest,
    options: grpc.CallOptions,
    callback: grpc.requestCallback<_universal_game_engine_CommonResponse__Output>,
  ): grpc.ClientUnaryCall;
  DispatchAction(
    argument: _universal_game_engine_DispatchActionRequest,
    callback: grpc.requestCallback<_universal_game_engine_CommonResponse__Output>,
  ): grpc.ClientUnaryCall;
  dispatchAction(
    argument: _universal_game_engine_DispatchActionRequest,
    metadata: grpc.Metadata,
    options: grpc.CallOptions,
    callback: grpc.requestCallback<_universal_game_engine_CommonResponse__Output>,
  ): grpc.ClientUnaryCall;
  dispatchAction(
    argument: _universal_game_engine_DispatchActionRequest,
    metadata: grpc.Metadata,
    callback: grpc.requestCallback<_universal_game_engine_CommonResponse__Output>,
  ): grpc.ClientUnaryCall;
  dispatchAction(
    argument: _universal_game_engine_DispatchActionRequest,
    options: grpc.CallOptions,
    callback: grpc.requestCallback<_universal_game_engine_CommonResponse__Output>,
  ): grpc.ClientUnaryCall;
  dispatchAction(
    argument: _universal_game_engine_DispatchActionRequest,
    callback: grpc.requestCallback<_universal_game_engine_CommonResponse__Output>,
  ): grpc.ClientUnaryCall;

  Reset(
    argument: _universal_game_engine_ResetGameRequest,
    metadata: grpc.Metadata,
    options: grpc.CallOptions,
    callback: grpc.requestCallback<_universal_game_engine_ResetGameResponse__Output>,
  ): grpc.ClientUnaryCall;
  Reset(
    argument: _universal_game_engine_ResetGameRequest,
    metadata: grpc.Metadata,
    callback: grpc.requestCallback<_universal_game_engine_ResetGameResponse__Output>,
  ): grpc.ClientUnaryCall;
  Reset(
    argument: _universal_game_engine_ResetGameRequest,
    options: grpc.CallOptions,
    callback: grpc.requestCallback<_universal_game_engine_ResetGameResponse__Output>,
  ): grpc.ClientUnaryCall;
  Reset(
    argument: _universal_game_engine_ResetGameRequest,
    callback: grpc.requestCallback<_universal_game_engine_ResetGameResponse__Output>,
  ): grpc.ClientUnaryCall;
  reset(
    argument: _universal_game_engine_ResetGameRequest,
    metadata: grpc.Metadata,
    options: grpc.CallOptions,
    callback: grpc.requestCallback<_universal_game_engine_ResetGameResponse__Output>,
  ): grpc.ClientUnaryCall;
  reset(
    argument: _universal_game_engine_ResetGameRequest,
    metadata: grpc.Metadata,
    callback: grpc.requestCallback<_universal_game_engine_ResetGameResponse__Output>,
  ): grpc.ClientUnaryCall;
  reset(
    argument: _universal_game_engine_ResetGameRequest,
    options: grpc.CallOptions,
    callback: grpc.requestCallback<_universal_game_engine_ResetGameResponse__Output>,
  ): grpc.ClientUnaryCall;
  reset(
    argument: _universal_game_engine_ResetGameRequest,
    callback: grpc.requestCallback<_universal_game_engine_ResetGameResponse__Output>,
  ): grpc.ClientUnaryCall;

  SendChat(
    argument: _universal_game_engine_ChatMessage,
    metadata: grpc.Metadata,
    options: grpc.CallOptions,
    callback: grpc.requestCallback<_universal_game_engine_CommonResponse__Output>,
  ): grpc.ClientUnaryCall;
  SendChat(
    argument: _universal_game_engine_ChatMessage,
    metadata: grpc.Metadata,
    callback: grpc.requestCallback<_universal_game_engine_CommonResponse__Output>,
  ): grpc.ClientUnaryCall;
  SendChat(
    argument: _universal_game_engine_ChatMessage,
    options: grpc.CallOptions,
    callback: grpc.requestCallback<_universal_game_engine_CommonResponse__Output>,
  ): grpc.ClientUnaryCall;
  SendChat(
    argument: _universal_game_engine_ChatMessage,
    callback: grpc.requestCallback<_universal_game_engine_CommonResponse__Output>,
  ): grpc.ClientUnaryCall;
  sendChat(
    argument: _universal_game_engine_ChatMessage,
    metadata: grpc.Metadata,
    options: grpc.CallOptions,
    callback: grpc.requestCallback<_universal_game_engine_CommonResponse__Output>,
  ): grpc.ClientUnaryCall;
  sendChat(
    argument: _universal_game_engine_ChatMessage,
    metadata: grpc.Metadata,
    callback: grpc.requestCallback<_universal_game_engine_CommonResponse__Output>,
  ): grpc.ClientUnaryCall;
  sendChat(
    argument: _universal_game_engine_ChatMessage,
    options: grpc.CallOptions,
    callback: grpc.requestCallback<_universal_game_engine_CommonResponse__Output>,
  ): grpc.ClientUnaryCall;
  sendChat(
    argument: _universal_game_engine_ChatMessage,
    callback: grpc.requestCallback<_universal_game_engine_CommonResponse__Output>,
  ): grpc.ClientUnaryCall;

  Step(
    argument: _universal_game_engine_StepRequest,
    metadata: grpc.Metadata,
    options: grpc.CallOptions,
    callback: grpc.requestCallback<_universal_game_engine_StepResponse__Output>,
  ): grpc.ClientUnaryCall;
  Step(
    argument: _universal_game_engine_StepRequest,
    metadata: grpc.Metadata,
    callback: grpc.requestCallback<_universal_game_engine_StepResponse__Output>,
  ): grpc.ClientUnaryCall;
  Step(
    argument: _universal_game_engine_StepRequest,
    options: grpc.CallOptions,
    callback: grpc.requestCallback<_universal_game_engine_StepResponse__Output>,
  ): grpc.ClientUnaryCall;
  Step(
    argument: _universal_game_engine_StepRequest,
    callback: grpc.requestCallback<_universal_game_engine_StepResponse__Output>,
  ): grpc.ClientUnaryCall;
  step(
    argument: _universal_game_engine_StepRequest,
    metadata: grpc.Metadata,
    options: grpc.CallOptions,
    callback: grpc.requestCallback<_universal_game_engine_StepResponse__Output>,
  ): grpc.ClientUnaryCall;
  step(
    argument: _universal_game_engine_StepRequest,
    metadata: grpc.Metadata,
    callback: grpc.requestCallback<_universal_game_engine_StepResponse__Output>,
  ): grpc.ClientUnaryCall;
  step(
    argument: _universal_game_engine_StepRequest,
    options: grpc.CallOptions,
    callback: grpc.requestCallback<_universal_game_engine_StepResponse__Output>,
  ): grpc.ClientUnaryCall;
  step(
    argument: _universal_game_engine_StepRequest,
    callback: grpc.requestCallback<_universal_game_engine_StepResponse__Output>,
  ): grpc.ClientUnaryCall;

  StreamEvents(
    argument: _universal_game_engine_JoinGameRequest,
    metadata: grpc.Metadata,
    options?: grpc.CallOptions,
  ): grpc.ClientReadableStream<_universal_game_engine_GameEvent__Output>;
  StreamEvents(
    argument: _universal_game_engine_JoinGameRequest,
    options?: grpc.CallOptions,
  ): grpc.ClientReadableStream<_universal_game_engine_GameEvent__Output>;
  streamEvents(
    argument: _universal_game_engine_JoinGameRequest,
    metadata: grpc.Metadata,
    options?: grpc.CallOptions,
  ): grpc.ClientReadableStream<_universal_game_engine_GameEvent__Output>;
  streamEvents(
    argument: _universal_game_engine_JoinGameRequest,
    options?: grpc.CallOptions,
  ): grpc.ClientReadableStream<_universal_game_engine_GameEvent__Output>;

  SubmitTurn(
    argument: _universal_game_engine_SubmitTurnRequest,
    metadata: grpc.Metadata,
    options: grpc.CallOptions,
    callback: grpc.requestCallback<_universal_game_engine_CommonResponse__Output>,
  ): grpc.ClientUnaryCall;
  SubmitTurn(
    argument: _universal_game_engine_SubmitTurnRequest,
    metadata: grpc.Metadata,
    callback: grpc.requestCallback<_universal_game_engine_CommonResponse__Output>,
  ): grpc.ClientUnaryCall;
  SubmitTurn(
    argument: _universal_game_engine_SubmitTurnRequest,
    options: grpc.CallOptions,
    callback: grpc.requestCallback<_universal_game_engine_CommonResponse__Output>,
  ): grpc.ClientUnaryCall;
  SubmitTurn(
    argument: _universal_game_engine_SubmitTurnRequest,
    callback: grpc.requestCallback<_universal_game_engine_CommonResponse__Output>,
  ): grpc.ClientUnaryCall;
  submitTurn(
    argument: _universal_game_engine_SubmitTurnRequest,
    metadata: grpc.Metadata,
    options: grpc.CallOptions,
    callback: grpc.requestCallback<_universal_game_engine_CommonResponse__Output>,
  ): grpc.ClientUnaryCall;
  submitTurn(
    argument: _universal_game_engine_SubmitTurnRequest,
    metadata: grpc.Metadata,
    callback: grpc.requestCallback<_universal_game_engine_CommonResponse__Output>,
  ): grpc.ClientUnaryCall;
  submitTurn(
    argument: _universal_game_engine_SubmitTurnRequest,
    options: grpc.CallOptions,
    callback: grpc.requestCallback<_universal_game_engine_CommonResponse__Output>,
  ): grpc.ClientUnaryCall;
  submitTurn(
    argument: _universal_game_engine_SubmitTurnRequest,
    callback: grpc.requestCallback<_universal_game_engine_CommonResponse__Output>,
  ): grpc.ClientUnaryCall;

  WaitForTurn(
    argument: _universal_game_engine_WaitForTurnRequest,
    metadata: grpc.Metadata,
    options?: grpc.CallOptions,
  ): grpc.ClientReadableStream<_universal_game_engine_WaitForTurnResponse__Output>;
  WaitForTurn(
    argument: _universal_game_engine_WaitForTurnRequest,
    options?: grpc.CallOptions,
  ): grpc.ClientReadableStream<_universal_game_engine_WaitForTurnResponse__Output>;
  waitForTurn(
    argument: _universal_game_engine_WaitForTurnRequest,
    metadata: grpc.Metadata,
    options?: grpc.CallOptions,
  ): grpc.ClientReadableStream<_universal_game_engine_WaitForTurnResponse__Output>;
  waitForTurn(
    argument: _universal_game_engine_WaitForTurnRequest,
    options?: grpc.CallOptions,
  ): grpc.ClientReadableStream<_universal_game_engine_WaitForTurnResponse__Output>;
}

export interface GameServiceHandlers extends grpc.UntypedServiceImplementation {
  CreateGame: grpc.handleUnaryCall<
    _universal_game_engine_CreateGameRequest__Output,
    _universal_game_engine_CreateGameResponse
  >;

  DispatchAction: grpc.handleUnaryCall<
    _universal_game_engine_DispatchActionRequest__Output,
    _universal_game_engine_CommonResponse
  >;

  Reset: grpc.handleUnaryCall<
    _universal_game_engine_ResetGameRequest__Output,
    _universal_game_engine_ResetGameResponse
  >;

  SendChat: grpc.handleUnaryCall<
    _universal_game_engine_ChatMessage__Output,
    _universal_game_engine_CommonResponse
  >;

  Step: grpc.handleUnaryCall<
    _universal_game_engine_StepRequest__Output,
    _universal_game_engine_StepResponse
  >;

  StreamEvents: grpc.handleServerStreamingCall<
    _universal_game_engine_JoinGameRequest__Output,
    _universal_game_engine_GameEvent
  >;

  SubmitTurn: grpc.handleUnaryCall<
    _universal_game_engine_SubmitTurnRequest__Output,
    _universal_game_engine_CommonResponse
  >;

  WaitForTurn: grpc.handleServerStreamingCall<
    _universal_game_engine_WaitForTurnRequest__Output,
    _universal_game_engine_WaitForTurnResponse
  >;
}

export interface GameServiceDefinition extends grpc.ServiceDefinition {
  CreateGame: MethodDefinition<
    _universal_game_engine_CreateGameRequest,
    _universal_game_engine_CreateGameResponse,
    _universal_game_engine_CreateGameRequest__Output,
    _universal_game_engine_CreateGameResponse__Output
  >;
  DispatchAction: MethodDefinition<
    _universal_game_engine_DispatchActionRequest,
    _universal_game_engine_CommonResponse,
    _universal_game_engine_DispatchActionRequest__Output,
    _universal_game_engine_CommonResponse__Output
  >;
  Reset: MethodDefinition<
    _universal_game_engine_ResetGameRequest,
    _universal_game_engine_ResetGameResponse,
    _universal_game_engine_ResetGameRequest__Output,
    _universal_game_engine_ResetGameResponse__Output
  >;
  SendChat: MethodDefinition<
    _universal_game_engine_ChatMessage,
    _universal_game_engine_CommonResponse,
    _universal_game_engine_ChatMessage__Output,
    _universal_game_engine_CommonResponse__Output
  >;
  Step: MethodDefinition<
    _universal_game_engine_StepRequest,
    _universal_game_engine_StepResponse,
    _universal_game_engine_StepRequest__Output,
    _universal_game_engine_StepResponse__Output
  >;
  StreamEvents: MethodDefinition<
    _universal_game_engine_JoinGameRequest,
    _universal_game_engine_GameEvent,
    _universal_game_engine_JoinGameRequest__Output,
    _universal_game_engine_GameEvent__Output
  >;
  SubmitTurn: MethodDefinition<
    _universal_game_engine_SubmitTurnRequest,
    _universal_game_engine_CommonResponse,
    _universal_game_engine_SubmitTurnRequest__Output,
    _universal_game_engine_CommonResponse__Output
  >;
  WaitForTurn: MethodDefinition<
    _universal_game_engine_WaitForTurnRequest,
    _universal_game_engine_WaitForTurnResponse,
    _universal_game_engine_WaitForTurnRequest__Output,
    _universal_game_engine_WaitForTurnResponse__Output
  >;
}
