// electron/preload.ts
import { contextBridge, ipcRenderer } from 'electron';
import type { GameCreateOptions, GameMetadata, ChatMessage } from '@engine/shared/network/INetworkClient';
import { BaseGameState } from '@engine/shared/GameRules';

contextBridge.exposeInMainWorld('electronAPI', {
    // --- Vue から Main へ送信 (Commands) ---
    createGame: (options: GameCreateOptions) => ipcRenderer.invoke('grpc:createGame', options),
    connect: (gameId: string, options?: { asSpectator?: boolean }) => ipcRenderer.invoke('grpc:connect', gameId, options),
    disconnect: () => ipcRenderer.invoke('grpc:disconnect'),
    sendAction: (action: unknown) => ipcRenderer.invoke('grpc:sendAction', action),
    sendChat: (message: string, channel: string, recipientId?: string) => ipcRenderer.invoke('grpc:sendChat', message, channel, recipientId),

    // --- Main から Vue へ受信 (Events) ---
    onStateUpdate: (callback: (state: BaseGameState) => void) => {
        ipcRenderer.on('grpc:stateUpdate', (_event, state) => callback(state));
    },
    onMetadataUpdate: (callback: (metadata: GameMetadata) => void) => {
        ipcRenderer.on('grpc:metadataUpdate', (_event, metadata) => callback(metadata));
    },
    onChatMessage: (callback: (chat: ChatMessage) => void) => {
        ipcRenderer.on('grpc:chatMessage', (_event, chat) => callback(chat));
    },
    onError: (callback: (error: string) => void) => {
        ipcRenderer.on('grpc:error', (_event, error) => callback(error));
    },

    // コンポーネントのアンマウント時などにリスナーを解除する用
    removeAllListeners: () => {
        ipcRenderer.removeAllListeners('grpc:stateUpdate');
        ipcRenderer.removeAllListeners('grpc:metadataUpdate');
        ipcRenderer.removeAllListeners('grpc:chatMessage');
        ipcRenderer.removeAllListeners('grpc:error');
    }
});