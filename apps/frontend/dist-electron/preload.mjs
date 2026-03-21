let electron = require("electron");
//#region electron/preload.ts
electron.contextBridge.exposeInMainWorld("electronAPI", {
  createGame: (options) => electron.ipcRenderer.invoke("grpc:createGame", options),
  connect: (gameId, options) => electron.ipcRenderer.invoke("grpc:connect", gameId, options),
  disconnect: () => electron.ipcRenderer.invoke("grpc:disconnect"),
  sendAction: (action) => electron.ipcRenderer.invoke("grpc:sendAction", action),
  sendChat: (message, channel, recipientId) =>
    electron.ipcRenderer.invoke("grpc:sendChat", message, channel, recipientId),
  onStateUpdate: (callback) => {
    electron.ipcRenderer.on("grpc:stateUpdate", (_event, state) => callback(state));
  },
  onMetadataUpdate: (callback) => {
    electron.ipcRenderer.on("grpc:metadataUpdate", (_event, metadata) => callback(metadata));
  },
  onChatMessage: (callback) => {
    electron.ipcRenderer.on("grpc:chatMessage", (_event, chat) => callback(chat));
  },
  onError: (callback) => {
    electron.ipcRenderer.on("grpc:error", (_event, error) => callback(error));
  },
  removeAllListeners: () => {
    electron.ipcRenderer.removeAllListeners("grpc:stateUpdate");
    electron.ipcRenderer.removeAllListeners("grpc:metadataUpdate");
    electron.ipcRenderer.removeAllListeners("grpc:chatMessage");
    electron.ipcRenderer.removeAllListeners("grpc:error");
  },
});
//#endregion
