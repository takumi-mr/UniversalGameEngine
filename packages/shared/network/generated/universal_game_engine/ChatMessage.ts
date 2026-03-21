// Original file: network/game.proto

export interface ChatMessage {
  userId?: string;
  message?: string;
  channel?: string;
  recipientId?: string;
  timestamp?: string;
  gameId?: string;
}

export interface ChatMessage__Output {
  userId: string;
  message: string;
  channel: string;
  recipientId: string;
  timestamp: string;
  gameId: string;
}
