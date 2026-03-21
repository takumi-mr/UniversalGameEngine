// electron/main.ts
import { app, BrowserWindow, ipcMain } from "electron";
import path from "node:path";
import { GrpcNetworkClient } from "../network/GrpcNetworkClient";

// ESM環境で __dirname を使えるようにする
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let mainWindow: BrowserWindow | null = null;
let grpcClient: GrpcNetworkClient<any, any> | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, "preload.mjs"), // Viteのビルド設定によっては preload.js になります
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Viteの開発サーバーURLがある場合（開発モード）
  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    mainWindow.webContents.openDevTools();
  } else {
    // 本番ビルドモード
    mainWindow.loadFile(
      path.join(process.env.DIST || path.join(__dirname, "../dist"), "index.html"),
    );
  }
}

app.whenReady().then(() => {
  createWindow();

  // gRPCクライアントの初期化 (URLやトークンはログイン機能実装後に動的に渡すことも可能です)
  grpcClient = new GrpcNetworkClient("localhost:50051");

  // --- サーバーからの受信イベントを Renderer (Vue) へ転送 ---
  grpcClient.onStateUpdate = (state) => {
    mainWindow?.webContents.send("grpc:stateUpdate", state);
  };
  grpcClient.onMetadataUpdate = (metadata) => {
    mainWindow?.webContents.send("grpc:metadataUpdate", metadata);
  };
  grpcClient.onChatMessage = (chat) => {
    mainWindow?.webContents.send("grpc:chatMessage", chat);
  };
  grpcClient.onError = (error) => {
    mainWindow?.webContents.send("grpc:error", error);
  };

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// --- Renderer (Vue) からの要求を受け取って gRPC サーバーへ送信 ---
ipcMain.handle("grpc:createGame", async (_event, options) => {
  return await grpcClient?.createGame(options);
});

ipcMain.handle("grpc:connect", async (_event, gameId, options) => {
  return await grpcClient?.connect(gameId, options);
});

ipcMain.handle("grpc:disconnect", () => {
  grpcClient?.disconnect();
});

ipcMain.handle("grpc:sendAction", (_event, action) => {
  grpcClient?.sendAction(action);
});

ipcMain.handle("grpc:sendChat", (_event, message, channel, recipientId) => {
  grpcClient?.sendChat(message, channel, recipientId);
});
