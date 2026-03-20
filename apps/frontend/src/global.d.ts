// src/global.d.ts
export interface ElectronAPI {
    createGame: (options?: any) => Promise<string>;
    connect: (gameId: string, options?: any) => Promise<void>;
    disconnect: () => Promise<void>;
    sendAction: (action: any) => Promise<void>;
    sendChat: (message: string, channel: string, recipientId?: string) => Promise<void>;

    onStateUpdate: (callback: (state: any) => void) => void;
    onMetadataUpdate: (callback: (metadata: any) => void) => void;
    onChatMessage: (callback: (chat: any) => void) => void;
    onError: (callback: (error: string) => void) => void;
    removeAllListeners: () => void;
}

declare global {
    interface Window {
        electronAPI?: ElectronAPI;
    }
}