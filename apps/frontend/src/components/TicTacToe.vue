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
          <span :class="gameState.turn === 1 ? 'color-o' : 'color-x'">
            {{
              gameState.status === "PLAYING"
                ? gameState.turn === 1
                  ? "Player 1 (O)"
                  : "Player 2 (X)"
                : "-"
            }}
          </span>
        </div>
      </div>
    </div>

    <div class="board-layer" v-if="gameState">
      <div class="tictactoe-board">
        <div 
          v-for="(cell, index) in gameState.board" 
          :key="`cell-${index}`" 
          class="cell"
          :class="{ 'is-clickable': isClickable(index) }"
          @click="placePiece(index)"
        >
          <span 
            v-if="cell === 1" 
            class="piece piece-o"
          >O</span>
          <span 
            v-else-if="cell === -1" 
            class="piece piece-x"
          >X</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";
import type { INetworkClient } from "@engine/shared/network/INetworkClient";
import { SocketIoClient } from "../network/SocketIoClient";
import type { TicTacToeState, TicTacToeAction } from "@engine/shared/rules/TicTacToeRuleset";

const props = defineProps<{ authToken: string; }>();

const gameState = ref<TicTacToeState | null>(null);
const errorMessage = ref<string>("");
const roomId = ref<string>("Connecting...");

const API_BASE_URL = "http://127.0.0.1:3000";

let networkClient: INetworkClient<TicTacToeState, TicTacToeAction>;

onMounted(() => {
  networkClient = new SocketIoClient(API_BASE_URL, props.authToken);

  networkClient.onStateUpdate = (state: TicTacToeState) => {
    gameState.value = state;
    errorMessage.value = "";
  };

  networkClient.onError = (msg: string) => {
    errorMessage.value = msg;
  };

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
    // サーバーの request-create-game に type: 'TICTACTOE' 等を投げる
    const id = await networkClient.createGame({ type: 'TICTACTOE' });
    roomId.value = id;
    window.history.pushState({}, "", `?id=${id}`);
    networkClient.connect(id);
  } catch (e) {
    errorMessage.value = "Failed to create game.";
  }
};

// UIのヘルパー関数: マスがクリック可能かどうか
const isClickable = (index: number): boolean => {
  if (!gameState.value || gameState.value.status !== 'PLAYING') return false;
  
  // 空きマスかチェック
  if (gameState.value.board[index] !== 0) return false;

  // （オプション）自分がプレイヤーとして割り当てられている場合、自分の手番かチェック
  // 今回はモックとして全員がクリックできるようにしておく（サーバー側でバリデーションされるため）
  return true;
};

// マスがクリックされた時
const placePiece = (index: number) => {
  if (!isClickable(index)) return;

  const action: TicTacToeAction = {
    type: 'PLACE',
    index
  };
  
  networkClient.sendAction(action);
};
</script>

<style scoped>
/* 基本レイアウト */
.app-container {
  position: relative;
  width: 100vw;
  height: 100vh;
  background-color: #1a1a2e; /* ダークでモダンな背景 */
  display: flex;
  align-items: center;
  justify-content: center;
}
.ui-layer {
  position: absolute;
  top: 15px;
  left: 15px;
  z-index: 10;
}
.panel {
  background: rgba(10, 10, 20, 0.85);
  color: white;
  padding: 20px;
  border-radius: 12px;
  border: 1px solid #333;
  box-shadow: 0 4px 15px rgba(0,0,0,0.5);
  min-width: 250px;
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
.error { color: #ff5555; font-weight: bold; margin-bottom: 10px; }
.status-msg { color: #f1c40f; font-weight: bold; font-size: 1.4em; margin-bottom: 10px; text-shadow: 0 0 10px rgba(241, 196, 15, 0.5); }
.turn-indicator { font-size: 1.2em; font-weight: bold; }

/* O と X のテーマカラー */
.color-o { color: #00ffff; text-shadow: 0 0 10px rgba(0, 255, 255, 0.8); }
.color-x { color: #ff0055; text-shadow: 0 0 10px rgba(255, 0, 85, 0.8); }

/* 盤面のレイアウト */
.board-layer {
  width: 100%;
  max-width: 500px;
  padding: 20px;
}
.tictactoe-board {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  grid-template-rows: repeat(3, 1fr);
  aspect-ratio: 1 / 1;
  gap: 10px; /* マス目の間隔 */
}

/* 個別のマス */
.cell {
  background-color: rgba(255, 255, 255, 0.05);
  border-radius: 15px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background-color 0.2s ease, transform 0.1s ease;
  box-shadow: inset 0 0 20px rgba(0,0,0,0.5);
}
.cell.is-clickable {
  cursor: pointer;
}
.cell.is-clickable:hover {
  background-color: rgba(255, 255, 255, 0.1);
}
.cell.is-clickable:active {
  transform: scale(0.95);
}

/* 配置されたマーク（ネオン風） */
.piece {
  font-family: 'Arial', sans-serif;
  font-size: 5rem;
  font-weight: bold;
  user-select: none;
  animation: popIn 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards;
}
.piece-o {
  color: #00ffff;
  text-shadow: 0 0 20px rgba(0, 255, 255, 0.6), 0 0 40px rgba(0, 255, 255, 0.4);
}
.piece-x {
  color: #ff0055;
  text-shadow: 0 0 20px rgba(255, 0, 85, 0.6), 0 0 40px rgba(255, 0, 85, 0.4);
}

/* 石が置かれた時のポップアニメーション */
@keyframes popIn {
  0% { transform: scale(0.3); opacity: 0; }
  100% { transform: scale(1); opacity: 1; }
}
</style>