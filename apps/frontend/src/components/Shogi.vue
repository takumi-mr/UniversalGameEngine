<template>
  <div class="shogi-container" v-if="state">
    <div class="shogi-ui-overlay">
      <div v-if="state.message" class="status-msg">
        {{ state.message }}
      </div>

      <div class="turn-indicator" v-if="state.status === 'PLAYING'">
        Turn:
        <span :class="state.turn === 1 ? 'color-sente' : 'color-gote'">
          {{ state.turn === 1 ? "Sente (先手)" : "Gote (後手)" }}
        </span>
      </div>

      <div class="hands-board">
        <div class="hand-gote">
          後手持駒: {{ formatHand(state.hands['-1']) }}
        </div>
        <div class="hand-sente">
          先手持駒: {{ formatHand(state.hands['1']) }}
        </div>
      </div>

      <div v-if="showPromoteDialog" class="promote-dialog">
        <p>成りますか？</p>
        <div class="dialog-buttons">
          <button @click="confirmMove(true)">成る</button>
          <button @click="confirmMove(false)">成らない</button>
        </div>
      </div>
    </div>

    <div ref="canvasContainer" class="canvas-layer"></div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch } from "vue";
import { ShogiUI } from "../three/ShogiUI";
import type { ShogiState, ShogiAction } from "@engine/shared/rules/ShogiRuleset";

const props = defineProps<{
  state: ShogiState;
}>();

const emit = defineEmits<{
  (e: 'action', action: ShogiAction): void;
}>();

const canvasContainer = ref<HTMLElement | null>(null);

// 成り選択用の一時退避ステート
const showPromoteDialog = ref(false);
const pendingMoveAction = ref<ShogiAction | null>(null);

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
  if (canvasContainer.value) {
    threeUI = new ShogiUI(canvasContainer.value, handleActionFromUI);
    // 初回レンダリング
    if (props.state) {
      threeUI.renderState(props.state);
    }
  }
});

// props.state の変更を監視して Three.js 側を更新
watch(() => props.state, (newState) => {
  if (threeUI && newState) {
    threeUI.renderState(newState);
  }
}, { deep: true });

// Three.js 側からのアクション（クリック）を受け取る
const handleActionFromUI = (action: ShogiAction, canPromote: boolean) => {
  if (action.type === 'MOVE' && canPromote) {
    // 成れる移動の場合、ダイアログを表示して待機
    pendingMoveAction.value = action;
    showPromoteDialog.value = true;
  } else {
    // それ以外（成り不可、または打つ）は即送信
    emit('action', action);
  }
};

// ダイアログで成り/不成を選択した時
const confirmMove = (promote: boolean) => {
  if (pendingMoveAction.value) {
    pendingMoveAction.value.promote = promote;
    emit('action', pendingMoveAction.value);
  }
  showPromoteDialog.value = false;
  pendingMoveAction.value = null;
};
</script>

<style scoped>
.shogi-container {
  width: 100%;
  height: 100%;
  position: relative;
}

.shogi-ui-overlay {
  position: absolute;
  top: 20px;
  left: 20px;
  z-index: 10;
  pointer-events: none; /* UIの背後のキャンバスをクリックできるように */
}

.shogi-ui-overlay > * {
  pointer-events: auto; /* 子要素（ボタンなど）はクリック可能に */
}

.status-msg {
  background: rgba(0, 0, 0, 0.7);
  color: #f1c40f;
  padding: 8px 16px;
  border-radius: 4px;
  font-weight: bold;
  margin-bottom: 10px;
  display: inline-block;
}

.turn-indicator {
  background: rgba(0, 0, 0, 0.7);
  padding: 8px 16px;
  border-radius: 4px;
  margin-bottom: 10px;
  color: white;
  display: inline-block;
}

.color-sente { color: #4ade80; font-weight: bold; }
.color-gote { color: #f87171; font-weight: bold; }

.hands-board {
  background: rgba(0, 0, 0, 0.7);
  padding: 12px;
  border-radius: 8px;
  font-size: 0.9em;
  color: white;
}

.hand-gote { margin-bottom: 5px; color: #f87171; }
.hand-sente { color: #4ade80; }

.promote-dialog {
  margin-top: 15px;
  background: rgba(30, 41, 59, 0.95);
  padding: 15px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 12px;
  box-shadow: 0 10px 25px rgba(0,0,0,0.5);
  color: white;
  text-align: center;
}

.promote-dialog p {
  margin-bottom: 12px;
  font-weight: bold;
}

.dialog-buttons {
  display: flex;
  gap: 10px;
  justify-content: center;
}

.promote-dialog button {
  padding: 8px 16px;
  border-radius: 8px;
  border: none;
  cursor: pointer;
  font-weight: 600;
  transition: all 0.2s;
}

.promote-dialog button:first-child {
  background: #6366f1;
  color: white;
}

.promote-dialog button:last-child {
  background: rgba(255, 255, 255, 0.1);
  color: white;
}

.promote-dialog button:hover {
  transform: translateY(-1px);
  filter: brightness(1.1);
}

.canvas-layer {
  width: 100%;
  height: 100%;
}
</style>