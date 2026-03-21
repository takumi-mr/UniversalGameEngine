<template>
  <div class="chess-3d-container">
    <div ref="container" class="three-container" />

    <!-- Promotion Dialog (Reused from Chess.vue logic) -->
    <v-dialog v-model="showPromotionDialog" persistent max-width="400">
      <v-card class="rounded-xl">
        <v-card-title class="text-center pt-4"> 昇格する駒を選択 </v-card-title>
        <v-card-text>
          <div class="promotion-options d-flex justify-center gap-4 py-4">
            <v-btn icon size="x-large" variant="tonal" color="primary" @click="confirmPromotion(5)">
              <span class="piece-icon">{{ state.turn === 1 ? "♕" : "♛" }}</span>
            </v-btn>
            <v-btn icon size="x-large" variant="tonal" color="primary" @click="confirmPromotion(4)">
              <span class="piece-icon">{{ state.turn === 1 ? "♖" : "♜" }}</span>
            </v-btn>
            <v-btn icon size="x-large" variant="tonal" color="primary" @click="confirmPromotion(3)">
              <span class="piece-icon">{{ state.turn === 1 ? "♗" : "♝" }}</span>
            </v-btn>
            <v-btn icon size="x-large" variant="tonal" color="primary" @click="confirmPromotion(2)">
              <span class="piece-icon">{{ state.turn === 1 ? "♘" : "♞" }}</span>
            </v-btn>
          </div>
        </v-card-text>
        <v-card-actions class="justify-center pb-4">
          <v-btn color="error" variant="text" @click="cancelPromotion"> キャンセル </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <div class="controls-overlay">
      <v-chip size="small" variant="tonal" color="info" class="mb-2">
        <v-icon start icon="mdi-camera-control" />
        右ドラッグで回転 / スクロールでズーム
      </v-chip>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from "vue";
import { Chess3DUI } from "../../three/Chess3DUI";
import type { ChessState, ChessAction } from "@engine/shared/rules/ChessRuleset";

const props = defineProps<{
  state: ChessState;
  myPlayerId?: string;
}>();

const emit = defineEmits<{ (e: "action", action: ChessAction): void }>();

const container = ref<HTMLElement | null>(null);
let ui: Chess3DUI | null = null;

const showPromotionDialog = ref(false);
const pendingMove = ref<{ from: number; to: number } | null>(null);

onMounted(() => {
  if (container.value) {
    ui = new Chess3DUI(
      container.value,
      (action) => {
        // Ensure playerId is attached
        const isPlayer = Object.values(props.state.players || {}).includes(props.myPlayerId || "");
        if (isPlayer) {
          emit("action", { ...action, playerId: props.myPlayerId });
        }
      },
      (from, to) => {
        pendingMove.value = { from, to };
        showPromotionDialog.value = true;
      },
    );
    ui.renderState(props.state);
  }
});

watch(
  () => props.state,
  (newState) => {
    if (ui) ui.renderState(newState);
  },
  { deep: true },
);

onUnmounted(() => {
  ui?.dispose();
});

const confirmPromotion = (promotion: number) => {
  if (pendingMove.value) {
    emit("action", {
      type: "MOVE",
      from: pendingMove.value.from,
      to: pendingMove.value.to,
      promotion,
      playerId: props.myPlayerId,
    });
  }
  showPromotionDialog.value = false;
  pendingMove.value = null;
};

const cancelPromotion = () => {
  showPromotionDialog.value = false;
  pendingMove.value = null;
  // Re-render state to clear selection in UI
  if (ui) ui.renderState(props.state);
};
</script>

<style scoped>
.chess-3d-container {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: #000;
}

.three-container {
  width: 100%;
  height: 100%;
}

.piece-icon {
  font-size: 2rem;
}

.controls-overlay {
  position: absolute;
  bottom: 20px;
  left: 20px;
  pointer-events: none;
  display: flex;
  flex-direction: column;
}

.gap-4 {
  gap: 16px;
}
</style>
