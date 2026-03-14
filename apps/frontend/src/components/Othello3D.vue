<template>
  <div class="app-container">
    <div class="ui-layer" v-if="gameState">
      <div class="panel">
        <div class="room-info">
          Room ID: <span>{{ roomId }}</span>
          <button @click="createNewGame">New Game</button>
        </div>

        <div v-if="errorMessage" class="error">{{ errorMessage }}</div>
        <div v-if="gameState.message" class="status-msg">
          {{ gameState.message }}
        </div>

        <div class="turn-indicator">
          Turn:
          <span
            :class="gameState.currentTurn === 1 ? 'color-black' : 'color-white'"
          >
            {{
              gameState.status === "PLAYING"
                ? gameState.currentTurn === 1
                  ? "Black"
                  : "White"
                : "-"
            }}
          </span>
        </div>

        <div class="score-board">
          Black: {{ gameState.scores[1] }} | White: {{ gameState.scores[-1] }}
        </div>
      </div>
    </div>

    <div ref="canvasContainer" class="canvas-layer"></div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";
import type { INetworkClient } from "@engine/shared/network/INetworkClient";
import { SocketIoClient } from "../network/SocketIoClient";
import { Othello3DUI } from "../three/Othello3DUI";
import type {
  GameState,
  MoveAction,
} from "@engine/shared/rules/Othello3DRules";

const props = defineProps<{
  authToken: string;
}>();

// --- ステート管理 ---
const gameState = ref<GameState | null>(null);
const errorMessage = ref<string>("");
const roomId = ref<string>("Connecting...");
const canvasContainer = ref<HTMLElement | null>(null);

const GAME_SIZE = 4;
// ※バックエンドのURL（必要に応じて変更してください）
const API_BASE_URL = "http://127.0.0.1:3000";

let networkClient: INetworkClient<GameState, MoveAction>;
let threeUI: Othello3DUI;

onMounted(() => {
  // 1. ネットワーク層の初期化 (JWTトークンを渡す)
  networkClient = new SocketIoClient(API_BASE_URL, props.authToken);

  // ネットワークからの状態更新をVueのリアクティブな変数に反映し、Three.jsにも渡す
  networkClient.onStateUpdate = (state: GameState) => {
    gameState.value = state;
    errorMessage.value = "";
    if (threeUI) threeUI.renderState(state);
  };

  networkClient.onError = (msg: string) => {
    errorMessage.value = msg;
  };

  // 2. Three.js描画層の初期化
  if (canvasContainer.value) {
    threeUI = new Othello3DUI(canvasContainer.value, GAME_SIZE, (action) => {
      networkClient.sendAction(action);
    });
  }

  // 3. アプリケーションの起動（URLの解釈）
  initApp();
});

const initApp = () => {
  const urlParams = new URLSearchParams(window.location.search);
  const id = urlParams.get("id");

  if (id) {
    roomId.value = id;
    networkClient.connect(id);
  } else {
    createNewGame();
  }
};

const createNewGame = async () => {
  try {
    // サーバーに接続（バックエンドの io.use ミドルウェアを通過させる）
    networkClient.connect("");
    // 接続後にタイムアウトしないように少し待つか、SocketIoClient側で対処する
    const id = await networkClient.createGame({ size: GAME_SIZE });
    roomId.value = id;
    window.history.pushState({}, "", `?id=${id}`);
    
    // UIを更新
    networkClient.connect(id); // 作成されたIDで改めてjoinする
  } catch (e) {
    console.error(e);
    errorMessage.value = "Failed to create game.";
  }
};
</script>

<style>
/* グローバルリセット */
body,
html {
  margin: 0;
  padding: 0;
  overflow: hidden;
  background-color: #1a1a1a;
  font-family: sans-serif;
}

/* レイアウト */
.app-container {
  position: relative;
  width: 100vw;
  height: 100vh;
}
.canvas-layer {
  width: 100%;
  height: 100%;
  display: block;
}
.ui-layer {
  position: absolute;
  top: 10px;
  left: 10px;
  z-index: 10;
  pointer-events: none;
}

/* パネルデザイン */
.panel {
  background: rgba(0, 0, 0, 0.7);
  color: white;
  padding: 15px;
  border-radius: 8px;
  min-width: 200px;
}
.room-info {
  border-bottom: 1px solid #444;
  padding-bottom: 10px;
  margin-bottom: 10px;
  pointer-events: auto;
  font-size: 0.9em;
  color: #88ff88;
}
.room-info button {
  background: #555;
  border: none;
  color: white;
  padding: 3px 8px;
  margin-left: 10px;
  cursor: pointer;
  border-radius: 4px;
}
.room-info button:hover {
  background: #777;
}

.turn-indicator {
  font-size: 1.2em;
  margin-bottom: 10px;
}
.score-board {
  font-size: 1.2em;
  font-weight: bold;
}
.error {
  color: #ff5555;
  font-weight: bold;
  margin-bottom: 10px;
}
.status-msg {
  font-size: 1.2em;
  font-weight: bold;
  color: #ffeb3b;
  margin-bottom: 10px;
  text-shadow: 0 0 5px #ffeb3b;
}

.color-black {
  color: #aaa;
}
.color-white {
  color: #fff;
  text-shadow: 0 0 5px #fff;
}
</style>
