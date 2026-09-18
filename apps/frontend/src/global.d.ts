// src/global.d.ts
import type {
  GameCreateOptions,
  GameMetadata,
  ChatMessage,
} from "@engine/shared/network/INetworkClient";
import type { BaseGameAction, BaseGameState } from "@engine/shared/GameRules";

/** electron/preload.ts が contextBridge で公開する API（型はそちらと揃える） */
export interface ElectronAPI {
  createGame: (options?: GameCreateOptions) => Promise<string>;
  connect: (gameId: string, options?: { asSpectator?: boolean }) => Promise<void>;
  disconnect: () => Promise<void>;
  sendAction: (action: BaseGameAction) => Promise<void>;
  sendChat: (message: string, channel: string, recipientId?: string) => Promise<void>;

  onStateUpdate: (callback: (state: BaseGameState) => void) => void;
  onMetadataUpdate: (callback: (metadata: GameMetadata) => void) => void;
  onChatMessage: (callback: (chat: ChatMessage) => void) => void;
  onError: (callback: (error: string) => void) => void;
  removeAllListeners: () => void;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}
