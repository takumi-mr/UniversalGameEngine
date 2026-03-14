<template>
  <div class="go-3d-container" v-if="state">
    <div class="ui-overlay">
      <div v-if="state.message" class="status-msg">
        {{ state.message }}
      </div>

      <div class="game-info">
        <div class="turn-indicator">
          Turn: 
          <span :class="state.turn === 1 ? 'color-black' : 'color-white'">
            {{ state.turn === 1 ? 'Black' : 'White' }}
          </span>
        </div>

        <div class="actions">
          <button 
            class="pass-btn" 
            @click="passTurn"
            :disabled="state.status !== 'PLAYING'"
          >
            🏳️ パス
          </button>
        </div>

        <div v-if="state.scores" class="score-board">
          <div class="score-row">
            <span class="dot black"></span> 黒: <strong>{{ state.scores.black }}</strong>
          </div>
          <div class="score-row">
            <span class="dot white"></span> 白: <strong>{{ state.scores.white }}</strong>
          </div>
        </div>
      </div>
    </div>

    <div ref="canvasContainer" class="canvas-layer"></div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from "vue";
import { Go3DUI } from "../../three/GoUI";
import type { GoState, GoAction } from "@engine/shared/rules/GoRuleset";

const props = defineProps<{ state: GoState }>();
const emit = defineEmits<{ (e: 'action', action: GoAction): void }>();

const canvasContainer = ref<HTMLElement | null>(null);
let threeUI: Go3DUI | null = null;

onMounted(() => {
  if (canvasContainer.value && props.state) {
    threeUI = new Go3DUI(canvasContainer.value, props.state.size, (action) => {
      emit('action', action);
    });
    threeUI.renderState(props.state);
  }
});

onUnmounted(() => {
  if (threeUI) threeUI.dispose();
});

watch(() => props.state, (newState) => {
  if (threeUI && newState) {
    threeUI.renderState(newState);
  }
}, { deep: true });

const passTurn = () => {
  if (props.state.status === 'PLAYING') {
    emit('action', { type: 'PASS' });
  }
};
</script>

<style scoped>
.go-3d-container {
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

.ui-overlay > * { pointer-events: auto; }

.status-msg {
  background: rgba(16, 185, 129, 0.2);
  backdrop-filter: blur(8px);
  border: 1px solid rgba(16, 185, 129, 0.4);
  color: #a7f3d0;
  padding: 8px 16px;
  border-radius: 8px;
  font-weight: 600;
  margin-bottom: 12px;
  display: inline-block;
}

.game-info {
  background: rgba(30, 41, 59, 0.8);
  backdrop-filter: blur(8px);
  border: 1px solid rgba(255, 255, 255, 0.1);
  padding: 16px;
  border-radius: 12px;
  color: white;
  min-width: 160px;
}

.turn-indicator {
  font-size: 0.9rem;
  font-weight: 700;
  margin-bottom: 12px;
  text-transform: uppercase;
}
.color-black { color: #f1f5f9; }
.color-white { color: #cbd5e1; text-shadow: 0 0 8px rgba(255, 255, 255, 0.5); }

.pass-btn {
  width: 100%;
  background: rgba(239, 68, 68, 0.2);
  color: #fca5a5;
  border: 1px solid rgba(239, 68, 68, 0.4);
  padding: 8px;
  border-radius: 8px;
  cursor: pointer;
  font-weight: 600;
  margin-bottom: 12px;
  transition: background 0.2s;
}
.pass-btn:hover:not(:disabled) { background: rgba(239, 68, 68, 0.4); }
.pass-btn:disabled { opacity: 0.5; cursor: not-allowed; }

.score-board { display: flex; flex-direction: column; gap: 8px; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 12px;}
.score-row { display: flex; align-items: center; gap: 10px; font-size: 1rem; }
.dot { width: 12px; height: 12px; border-radius: 50%; }
.dot.black { background: #111; border: 1px solid #444; }
.dot.white { background: #fff; border: 1px solid #cbd5e1; }

.canvas-layer { width: 100%; height: 100%; display: block; }
</style>