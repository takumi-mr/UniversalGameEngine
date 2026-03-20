import { BrowserWindow, app, ipcMain } from "electron";
import path, { dirname } from "node:path";
import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import path$1 from "path";
import { fileURLToPath } from "node:url";
//#region network/GrpcNetworkClient.ts
var __dirname$1 = dirname(fileURLToPath(import.meta.url));
var PROTO_PATH = path$1.resolve(__dirname$1, "../../../packages/shared/network/game.proto");
var packageDefinition = protoLoader.loadSync(PROTO_PATH, {
	keepCase: true,
	longs: String,
	enums: String,
	defaults: true,
	oneofs: true
});
var GameService = grpc.loadPackageDefinition(packageDefinition).universal_game_engine.GameService;
var GrpcNetworkClient = class {
	constructor(baseUrl = "localhost:50051", token = "") {
		this.gameId = null;
		this.playerId = null;
		this.eventStream = null;
		this.onStateUpdate = () => {};
		this.onError = () => {};
		this.client = new GameService(baseUrl, grpc.credentials.createInsecure());
		this.token = token;
		console.log("GrpcNetworkClient (Node.js) initialized for:", baseUrl);
	}
	buildGrpcMetadata() {
		const meta = new grpc.Metadata();
		if (this.token) meta.add("authorization", `Bearer ${this.token}`);
		return meta;
	}
	async createGame(options) {
		return new Promise((resolve, reject) => {
			const req = {
				gameType: options?.type ?? "tictactoe",
				optionsJson: JSON.stringify(options?.gameOptions ?? {})
			};
			this.client.CreateGame(req, this.buildGrpcMetadata(), (err, response) => {
				if (err) return reject(err);
				resolve(response.gameId);
			});
		});
	}
	async connect(gameId, options) {
		this.gameId = gameId;
		const req = {
			gameId,
			asSpectator: !!options?.asSpectator,
			userToken: this.token
		};
		this.eventStream = this.client.StreamEvents(req, this.buildGrpcMetadata());
		this.eventStream.on("data", (event) => {
			if (event.joined) {
				this.playerId = event.joined.assignedPlayerId;
				console.log("Joined game as player:", this.playerId);
			} else if (event.stateUpdate) {
				const update = event.stateUpdate;
				const state = JSON.parse(update.stateJson);
				this.onStateUpdate(state);
				if (this.onMetadataUpdate && update.metadata) this.onMetadataUpdate({
					playerCount: update.metadata.playerCount,
					spectatorCount: update.metadata.spectatorCount,
					activePlayers: update.metadata.activePlayers || []
				});
			} else if (event.chatMessage) this.onChatMessage?.(event.chatMessage);
			else if (event.errorMessage) this.onError(event.errorMessage);
		});
		this.eventStream.on("error", (err) => {
			if (err.code === grpc.status.CANCELLED) return;
			console.error("gRPC Stream Error:", err);
			this.onError(err.details || err.message || "Stream connection error");
			this.disconnect();
		});
		this.eventStream.on("end", () => {
			console.log("gRPC Stream ended by server");
			this.disconnect();
		});
		return Promise.resolve();
	}
	disconnect() {
		if (this.eventStream) {
			this.eventStream.cancel();
			this.eventStream = null;
		}
		this.gameId = null;
		this.playerId = null;
	}
	sendAction(action) {
		if (!this.gameId) return;
		const req = {
			gameId: this.gameId,
			action: {
				type: action.type,
				payloadJson: JSON.stringify(action)
			}
		};
		this.client.DispatchAction(req, this.buildGrpcMetadata(), (err, response) => {
			if (err) {
				this.onError(err.details || err.message);
				return;
			}
			if (!response.success) this.onError(response.message);
		});
	}
	sendChat(message, channel, recipientId) {
		if (!this.gameId) return;
		const req = {
			userId: this.playerId || "anonymous",
			message,
			channel,
			recipientId: recipientId || "",
			timestamp: (/* @__PURE__ */ new Date()).toISOString(),
			gameId: this.gameId
		};
		this.client.SendChat(req, this.buildGrpcMetadata(), (err, response) => {
			if (err) {
				this.onError(err.details || err.message);
				return;
			}
			if (!response.success) this.onError(response.message);
		});
	}
};
//#endregion
//#region electron/main.ts
var __dirname = dirname(fileURLToPath(import.meta.url));
var mainWindow = null;
var grpcClient = null;
function createWindow() {
	mainWindow = new BrowserWindow({
		width: 1200,
		height: 800,
		webPreferences: {
			preload: path.join(__dirname, "preload.mjs"),
			contextIsolation: true,
			nodeIntegration: false
		}
	});
	if (process.env.VITE_DEV_SERVER_URL) {
		mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
		mainWindow.webContents.openDevTools();
	} else mainWindow.loadFile(path.join(process.env.DIST || path.join(__dirname, "../dist"), "index.html"));
}
app.whenReady().then(() => {
	createWindow();
	grpcClient = new GrpcNetworkClient("localhost:50051");
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
//#endregion
