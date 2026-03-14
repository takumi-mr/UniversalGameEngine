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
          <span :class="gameState.turn === 1 ? 'color-sente' : 'color-gote'">
            {{
              gameState.status === "PLAYING"
                ? gameState.turn === 1
                  ? "Sente (先手)"
                  : "Gote (後手)"
                : "-"
            }}
          </span>
        </div>

        <div class="hands-board">
          <div class="hand-gote">
            後手持駒: {{ formatHand(gameState.hands['-1']) }}
          </div>
          <div class="hand-sente">
            先手持駒: {{ formatHand(gameState.hands['1']) }}
          </div>
        </div>

        <div v-if="showPromoteDialog" class="promote-dialog">
          <p>成りますか？</p>
          <button @click="confirmMove(true)">成る</button>
          <button @click="confirmMove(false)">成らない</button>
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
import { ShogiUI } from "../three/ShogiUI";
import type { ShogiState, ShogiAction } from "@engine/shared/rules/ShogiRuleset";

const props = defineProps<{
  authToken: string;
}>();

const gameState = ref<ShogiState | null>(null);
const errorMessage = ref<string>("");
const roomId = ref<string>("Connecting...");
const canvasContainer = ref<HTMLElement | null>(null);

// 成り選択用の一時退避ステート
const showPromoteDialog = ref(false);
const pendingMoveAction = ref<ShogiAction | null>(null);

const API_BASE_URL = "http://127.0.0.1:3000";
let networkClient: INetworkClient<ShogiState, ShogiAction>;
let threeUI: ShogiUI;

// 持ち駒をテキストで整形表示するヘルパー
const PIECE_NAMES: Record<number, string> = {
  1: "歩", 2: "香", 3: "桂", 4: "銀", 5: "金", 6: "角", 7: "飛", 8: "玉"
};
const formatHand = (hand: Record<number, number>) => {
  if (!hand) return "なし";
  const str = Object.entries(hand)
    .filter(([_, count]) => count > 0)
    .map(([piece, count]) => `${PIECE_NAMES[parseInt(piece)]}${count > 1 ? count : ''}`)
    .join(" ");
  return str || "なし";
};

onMounted(() => {
  networkClient = new SocketIoClient(API_BASE_URL, props.authToken);

  networkClient.onStateUpdate = (state: ShogiState) => {
    gameState.value = state;
    errorMessage.value = "";
    if (threeUI) threeUI.renderState(state);
  };

  networkClient.onError = (msg: string) => {
    errorMessage.value = msg;
  };

  if (canvasContainer.value) {
    threeUI = new ShogiUI(canvasContainer.value, handleActionFromUI);
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
    const id = await networkClient.createGame({ type: 'SHOGI' }); // typeを指定
    roomId.value = id;
    window.history.pushState({}, "", `?id=${id}`);
    networkClient.connect(id);
  } catch (e) {
    errorMessage.value = "Failed to create game.";
  }
};

// Three.js 側からのアクション（クリック）を受け取る
const handleActionFromUI = (action: ShogiAction, canPromote: boolean) => {
  if (action.type === 'MOVE' && canPromote) {
    // 成れる移動の場合、ダイアログを表示して待機
    pendingMoveAction.value = action;
    showPromoteDialog.value = true;
  } else {
    // それ以外（成り不可、または打つ）は即送信
    networkClient.sendAction(action);
  }
};

// ダイアログで成り/不成を選択した時
const confirmMove = (promote: boolean) => {
  if (pendingMoveAction.value) {
    pendingMoveAction.value.promote = promote;
    networkClient.sendAction(pendingMoveAction.value);
  }
  showPromoteDialog.value = false;
  pendingMoveAction.value = null;
};
</script>

<style scoped>
/* 基本レイアウトはオセロと同じ。将棋用の追加スタイルのみ */
.color-sente { color: #88ff88; }
.color-gote { color: #ff8888; }
.hands-board { margin-top: 10px; font-size: 0.9em; }
.hand-gote { margin-bottom: 5px; color: #ff8888; }
.hand-sente { color: #88ff88; }
.promote-dialog {
  margin-top: 15px;
  background: #333;
  padding: 10px;
  border: 1px solid #666;
  border-radius: 4px;
}
.promote-dialog button {
  margin-right: 5px;
  padding: 5px 10px;
  cursor: pointer;
}
</style>