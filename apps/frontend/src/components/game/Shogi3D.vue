<template>
  <div class="shogi-3d-container" v-if="state">
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
        <div class="hand-section gote">
          <div class="hand-label">Gote (後手)</div>
          <div class="hand-pieces">
            <template v-for="(count, piece) in state.hands['-1']" :key="piece">
              <div v-if="count > 0" 
                   class="hand-piece-item" 
                   :class="{ selected: selectedHandPiece?.piece === parseInt(piece) && selectedHandPiece?.owner === -1 }"
                   @click="selectHandPiece(parseInt(piece), -1)">
                {{ PIECE_NAMES[parseInt(piece)] }}<span class="count" v-if="count > 1">{{ count }}</span>
              </div>
            </template>
          </div>
        </div>

        <div class="hand-section sente">
          <div class="hand-label">Sente (先手)</div>
          <div class="hand-pieces">
            <template v-for="(count, piece) in state.hands['1']" :key="piece">
              <div v-if="count > 0" 
                   class="hand-piece-item" 
                   :class="{ selected: selectedHandPiece?.piece === parseInt(piece) && selectedHandPiece?.owner === 1 }"
                   @click="selectHandPiece(parseInt(piece), 1)">
                {{ PIECE_NAMES[parseInt(piece)] }}<span class="count" v-if="count > 1">{{ count }}</span>
              </div>
            </template>
          </div>
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

    <div ref="canvasContainer" class="canvas-layer" @click="handleCanvasClick"></div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from "vue";
import { Shogi3DUI } from "../../three/Shogi3DUI";
import type { ShogiState, ShogiAction } from "@engine/shared/rules/ShogiRuleset";

const props = defineProps<{
  state: ShogiState;
  myPlayerId?: string;
}>();

const emit = defineEmits<{
  (e: 'action', action: ShogiAction): void;
}>();

const canvasContainer = ref<HTMLElement | null>(null);
const showPromoteDialog = ref(false);
const pendingMoveAction = ref<ShogiAction | null>(null);

// 持ち駒選択
const selectedHandPiece = ref<{ piece: number, owner: number } | null>(null);

let threeUI: Shogi3DUI;

const PIECE_NAMES: Record<number, string> = {
  1: "歩", 2: "香", 3: "桂", 4: "銀", 5: "金", 6: "角", 7: "飛", 8: "玉"
};

onMounted(() => {
  if (canvasContainer.value) {
    threeUI = new Shogi3DUI(canvasContainer.value, handleActionFromUI, handleRequirePromotion);
    if (props.state) {
      threeUI.renderState(props.state);
    }
  }
});

onUnmounted(() => {
  if (threeUI) {
    threeUI.dispose();
  }
});

watch(() => props.state, (newState) => {
  if (threeUI && newState) {
    threeUI.renderState(newState);
  }
}, { deep: true });

const handleActionFromUI = (action: ShogiAction) => {
  const isPlayer = props.state.players && Object.values(props.state.players).includes(props.myPlayerId || '');
  if (!isPlayer) return;

  emit('action', action);
};

const handleRequirePromotion = (from: number, to: number) => {
  const isPlayer = props.state.players && Object.values(props.state.players).includes(props.myPlayerId || '');
  if (!isPlayer || props.state.turn !== Math.sign(props.state.board[from])) return;

  pendingMoveAction.value = { type: 'MOVE', from, to };
  showPromoteDialog.value = true;
};

const confirmMove = (promote: boolean) => {
  if (pendingMoveAction.value) {
    pendingMoveAction.value.promote = promote;
    emit('action', pendingMoveAction.value);
  }
  showPromoteDialog.value = false;
  pendingMoveAction.value = null;
};

const selectHandPiece = (piece: number, owner: number) => {
  // Only allow selecting if it's my turn
  if (props.state.turn !== owner) return;
  
  if (selectedHandPiece.value?.piece === piece && selectedHandPiece.value?.owner === owner) {
    selectedHandPiece.value = null;
  } else {
    selectedHandPiece.value = { piece, owner };
  }
};

const handleCanvasClick = (event: MouseEvent) => {
  // If a hand piece is selected, we might want to "drop" it on the board.
  // Shogi3DUI currently handles board-to-board moves.
  // To handle drops:
  // 1. We need to know where the user clicked on the board.
  // 2. We can ask Shogi3DUI for the logical index of the clicked square.
  
  // Implementation note: Shogi3DUI's internal raycaster is used for selection.
  // For drops, we can add a method to Shogi3DUI to check for a "DROP" attempt.
  // For now, let's keep it simple: if selectedHandPiece is set, 
  // the next valid click on an empty square in Shogi3DUI should trigger a DROP.
  
  // Actually, I should modify Shogi3DUI to accept a "selectedHandPiece" or handle drops.
  // I will update Shogi3DUI later if needed. For now, let's see if 3D pieces move.
};
</script>

<style scoped>
.shogi-3d-container {
  width: 100%;
  height: 100%;
  position: relative;
  background: #000;
}

.shogi-ui-overlay {
  position: absolute;
  top: 20px;
  left: 20px;
  right: 20px;
  z-index: 10;
  pointer-events: none;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.shogi-ui-overlay > * {
  pointer-events: auto;
}

.status-msg {
  background: rgba(0, 0, 0, 0.8);
  color: #f1c40f;
  padding: 10px 20px;
  border-radius: 8px;
  font-weight: bold;
  align-self: flex-start;
  border: 1px solid rgba(241, 196, 15, 0.3);
}

.turn-indicator {
  background: rgba(0, 0, 0, 0.8);
  padding: 10px 20px;
  border-radius: 8px;
  color: white;
  align-self: flex-start;
  border: 1px solid rgba(255, 255, 255, 0.1);
}

.color-sente { color: #4ade80; font-weight: bold; }
.color-gote { color: #f87171; font-weight: bold; }

.hands-board {
  display: flex;
  justify-content: space-between;
  width: 100%;
  margin-top: auto;
}

.hand-section {
  background: rgba(0, 0, 0, 0.8);
  padding: 15px;
  border-radius: 12px;
  min-width: 150px;
  border: 1px solid rgba(255, 255, 255, 0.1);
}

.hand-label {
  font-size: 0.8em;
  color: #aaa;
  margin-bottom: 10px;
  text-transform: uppercase;
  letter-spacing: 1px;
}

.hand-pieces {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.hand-piece-item {
  background: rgba(255, 255, 255, 0.05);
  padding: 6px 12px;
  border-radius: 6px;
  color: white;
  cursor: pointer;
  border: 1px solid rgba(255, 255, 255, 0.1);
  transition: all 0.2s;
  user-select: none;
}

.hand-piece-item:hover {
  background: rgba(255, 255, 255, 0.15);
}

.hand-piece-item.selected {
  background: rgba(99, 102, 241, 0.4);
  border-color: #6366f1;
  box-shadow: 0 0 10px rgba(99, 102, 241, 0.3);
}

.hand-piece-item .count {
  margin-left: 4px;
  font-size: 0.8em;
  opacity: 0.8;
}

.promote-dialog {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  background: rgba(30, 41, 59, 0.95);
  padding: 25px;
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 16px;
  box-shadow: 0 20px 50px rgba(0,0,0,0.6);
  color: white;
  text-align: center;
  backdrop-filter: blur(10px);
}

.promote-dialog p {
  margin-bottom: 20px;
  font-size: 1.2em;
  font-weight: bold;
}

.dialog-buttons {
  display: flex;
  gap: 15px;
  justify-content: center;
}

.promote-dialog button {
  padding: 10px 24px;
  border-radius: 10px;
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
  transform: scale(1.05);
}

.canvas-layer {
  width: 100%;
  height: 100%;
}
</style>
