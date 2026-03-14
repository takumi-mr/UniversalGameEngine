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
          <span :class="gameState.currentTurn === 1 ? 'color-black' : 'color-white'">
            {{
              gameState.status === "PLAYING"
                ? gameState.currentTurn === 1
                  ? "Black (黒)"
                  : "White (白)"
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
import type { OthelloState, OthelloAction } from "@engine/shared/rules/OthelloRuleset";
import { OthelloUI } from "../three/OthelloUI";

const props = defineProps<{ authToken: string; }>();

const gameState = ref<OthelloState | null>(null);
const errorMessage = ref<string>("");
const roomId = ref<string>("Connecting...");
const canvasContainer = ref<HTMLElement | null>(null);

const GAME_SIZE = 8;
const API_BASE_URL = "http://127.0.0.1:3000";

let networkClient: INetworkClient<OthelloState, OthelloAction>;
let threeUI: OthelloUI;

onMounted(() => {
  networkClient = new SocketIoClient(API_BASE_URL, props.authToken);

  networkClient.onStateUpdate = (state: OthelloState) => {
    gameState.value = state;
    errorMessage.value = "";
    // 状態が更新されたらThree.js側に丸投げ！
    if (threeUI) threeUI.renderState(state);
  };

  networkClient.onError = (msg: string) => {
    errorMessage.value = msg;
  };

  if (canvasContainer.value) {
    threeUI = new OthelloUI(canvasContainer.value, (action) => {
      networkClient.sendAction(action);
    });
  }

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
    networkClient.connect("");
    const id = await networkClient.createGame({ type: 'OTHELLO', options: { size: GAME_SIZE } });
    roomId.value = id;
    window.history.pushState({}, "", `?id=${id}`);
    networkClient.connect(id);
  } catch (e) {
    errorMessage.value = "Failed to create game.";
  }
};
</script>

<style scoped>
/* 全画面表示のスタイル */
.app-container {
  position: relative;
  width: 100vw;
  height: 100vh;
  overflow: hidden;
  background-color: #000;
}
.canvas-layer {
  width: 100%;
  height: 100%;
  display: block;
}
.ui-layer {
  position: absolute;
  top: 15px;
  left: 15px;
  z-index: 10;
  pointer-events: none; /* UIの背景をクリックスルーさせる */
}
.panel {
  background: rgba(10, 10, 20, 0.85);
  color: white;
  padding: 20px;
  border-radius: 12px;
  border: 1px solid #333;
  box-shadow: 0 4px 15px rgba(0,0,0,0.5);
  min-width: 250px;
  pointer-events: auto; /* ボタンなどは押せるようにする */
}
.room-info {
  border-bottom: 1px solid #444;
  padding-bottom: 12px;
  margin-bottom: 12px;
  font-size: 0.9em;
  color: #88ff88;
}
.room-info button {
  background: #3498db;
  border: none;
  color: white;
  padding: 5px 12px;
  margin-left: 10px;
  cursor: pointer;
  border-radius: 6px;
  font-weight: bold;
}
.room-info button:hover {
  background: #2980b9;
}
.error { color: #ff5555; font-weight: bold; margin-bottom: 10px; }
.status-msg { color: #ffeb3b; font-weight: bold; font-size: 1.2em; margin-bottom: 10px; }
.turn-indicator { font-size: 1.3em; margin-bottom: 10px; font-weight: bold; }
.score-board { font-size: 1.2em; font-weight: bold; }
.color-black { color: #aaaaaa; }
.color-white { color: #ffffff; text-shadow: 0 0 8px rgba(255,255,255,0.6); }
</style>