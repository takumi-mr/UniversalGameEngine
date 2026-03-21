<template>
  <div class="othello-container">
    <div class="game-wrapper">
      <div class="side-info">
        <div class="score-card black" :class="{ active: state.currentTurn === 1 }">
          <div class="avatar">⚫</div>
          <div class="details">
            <div class="label">Black</div>
            <div class="score">
              {{ state.scores[1] }}
            </div>
          </div>
        </div>

        <div class="status-center">
          <div class="turn-msg">
            {{ state.message }}
          </div>
        </div>

        <div class="score-card white" :class="{ active: state.currentTurn === -1 }">
          <div class="avatar">⚪</div>
          <div class="details">
            <div class="label">White</div>
            <div class="score">
              {{ state.scores[-1] }}
            </div>
          </div>
        </div>
      </div>

      <div ref="canvasContainer" class="board-3d-wrap" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, computed } from "vue";
import type { OthelloState, OthelloAction } from "@engine/shared/rules/OthelloRuleset";
import { OthelloRuleset } from "@engine/shared/rules/OthelloRuleset";
import { OthelloUI } from "../../three/OthelloUI";

const props = defineProps<{
  state: OthelloState;
  myPlayerId?: string;
}>();
const emit = defineEmits<{ (e: "action", action: OthelloAction): void }>();

const canvasContainer = ref<HTMLElement | null>(null);
let threeUI: OthelloUI;

const legalActions = computed(() => {
  if (!props.state || !props.myPlayerId) return [];
  return OthelloRuleset.getLegalActions(props.state, props.myPlayerId);
});

onMounted(() => {
  if (canvasContainer.value) {
    threeUI = new OthelloUI(canvasContainer.value, (action) => {
      // 観戦者ガード
      const isPlayer =
        props.state.players && Object.values(props.state.players).includes(props.myPlayerId || "");
      if (!isPlayer) return;

      emit("action", action);
    });
    // 初回レンダリング
    threeUI.renderState(props.state, legalActions.value);
  }
});

onUnmounted(() => {
  if (threeUI) {
    threeUI.dispose();
  }
});

// stateが更新されたらThree.js側に通知
watch(
  () => props.state,
  (newState) => {
    if (threeUI) {
      threeUI.renderState(newState, legalActions.value);
    }
  },
  { deep: true },
);
</script>

<style scoped>
@import url("https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;700&display=swap");

.othello-container {
  width: 100%;
  height: 100%;
  background: rgb(var(--v-theme-background));
  font-family: "Outfit", sans-serif;
  overflow: hidden;
}

.game-wrapper {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
}

.side-info {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 40px;
  padding: 20px;
  background: linear-gradient(to bottom, rgba(var(--v-theme-surface), 0.4), transparent);
  z-index: 10;
}

.score-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 20px;
  background: rgba(var(--v-theme-on-surface), 0.05);
  border-radius: 16px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.1);
  transition: all 0.3s ease;
  opacity: 0.6;
}
.score-card.active {
  opacity: 1;
  transform: scale(1.05);
  background: rgba(var(--v-theme-on-surface), 0.1);
  border-color: rgba(var(--v-theme-primary), 0.5);
  box-shadow: 0 0 20px rgba(var(--v-theme-primary), 0.2);
}

.score-card .avatar {
  font-size: 1.8rem;
}
.score-card .label {
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  color: rgb(var(--v-theme-on-surface));
  opacity: 0.7;
}
.score-card .score {
  font-size: 1.4rem;
  font-weight: 800;
  color: rgb(var(--v-theme-on-surface));
}

.status-center {
  text-align: center;
  min-width: 200px;
}
.turn-msg {
  font-size: 1rem;
  font-weight: 600;
  color: rgb(var(--v-theme-secondary));
  text-shadow: 0 0 10px rgba(var(--v-theme-secondary), 0.3);
}

.board-3d-wrap {
  flex: 1;
  min-height: 0;
}
</style>
