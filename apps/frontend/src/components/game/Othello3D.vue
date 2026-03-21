<template>
  <div v-if="state" class="othello-3d-container">
    <div class="ui-overlay">
      <div v-if="state.message" class="status-msg">
        {{ state.message }}
      </div>

      <div class="game-info">
        <div class="turn-indicator">
          Turn:
          <span :class="state.currentTurn === 1 ? 'color-black' : 'color-white'">
            {{ state.currentTurn === 1 ? "Black" : "White" }}
          </span>
        </div>

        <div class="score-board">
          <div class="score-row">
            <span class="dot black" /> Black:
            <strong>{{ state.scores[1] }}</strong>
          </div>
          <div class="score-row">
            <span class="dot white" /> White:
            <strong>{{ state.scores[-1] }}</strong>
          </div>
        </div>
      </div>
    </div>

    <div ref="canvasContainer" class="canvas-layer" />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from "vue";
import { Othello3DUI } from "../../three/Othello3DUI";
import type { GameState, MoveAction } from "@engine/shared/rules/Othello3DRuleset";

const props = defineProps<{
  state: GameState;
  myPlayerId?: string;
}>();
const emit = defineEmits<{ (e: "action", action: MoveAction): void }>();

const canvasContainer = ref<HTMLElement | null>(null);
const GAME_SIZE = 4;

let threeUI: Othello3DUI;

onMounted(() => {
  if (canvasContainer.value) {
    threeUI = new Othello3DUI(canvasContainer.value, GAME_SIZE, (action: MoveAction) => {
      // 観戦者ガード
      const isPlayer =
        props.state.players && Object.values(props.state.players).includes(props.myPlayerId || "");
      if (!isPlayer) return;

      emit("action", action);
    });

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

watch(
  () => props.state,
  (newState) => {
    if (threeUI && newState) {
      threeUI.renderState(newState);
    }
  },
  { deep: true },
);
</script>

<style scoped>
.othello-3d-container {
  width: 100%;
  height: 100%;
  position: relative;
  background-color: rgb(var(--v-theme-background));
}

.ui-overlay {
  position: absolute;
  top: 20px;
  left: 20px;
  z-index: 10;
  pointer-events: none;
}

.ui-overlay > * {
  pointer-events: auto;
}

.status-msg {
  background: rgba(var(--v-theme-primary), 0.15);
  backdrop-filter: blur(8px);
  border: 1px solid rgba(var(--v-theme-primary), 0.3);
  color: rgb(var(--v-theme-primary));
  padding: 8px 16px;
  border-radius: 8px;
  font-weight: 600;
  margin-bottom: 12px;
  display: inline-block;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
}

.game-info {
  background: rgba(var(--v-theme-surface), 0.8);
  backdrop-filter: blur(8px);
  border: 1px solid rgba(var(--v-theme-on-surface), 0.1);
  padding: 16px;
  border-radius: 12px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
  color: rgb(var(--v-theme-on-surface));
  min-width: 160px;
}

.turn-indicator {
  font-size: 0.9rem;
  font-weight: 700;
  margin-bottom: 12px;
  text-transform: uppercase;
  letter-spacing: 1px;
  color: rgb(var(--v-theme-on-surface));
  opacity: 0.6;
}

.color-black {
  color: rgb(var(--v-theme-primary));
}
.color-white {
  color: rgb(var(--v-theme-secondary));
  text-shadow: 0 0 8px rgba(var(--v-theme-secondary), 0.5);
}

.score-board {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.score-row {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 1rem;
}

.dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
}
.dot.black {
  background: rgb(var(--v-theme-primary));
  border: 1px solid rgba(var(--v-theme-on-surface), 0.2);
}
.dot.white {
  background: rgb(var(--v-theme-secondary));
  box-shadow: 0 0 8px rgba(var(--v-theme-secondary), 0.8);
}

.canvas-layer {
  width: 100%;
  height: 100%;
  display: block;
}
</style>
