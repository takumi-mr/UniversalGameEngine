<template>
  <div class="hanoi-container">
    <div class="game-header">
      <div class="stats">
        <div class="stat-item">
          <span class="stat-label">MOVES</span>
          <span class="stat-value">{{ state.moves }}</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">MIN MOVES</span>
          <span class="stat-value">{{ Math.pow(2, state.diskCount) - 1 }}</span>
        </div>
      </div>
      <div class="controls">
        <v-btn-toggle
          v-model="selectedDiskCount"
          mandatory
          class="count-toggle"
          @update:model-value="resetGame"
        >
          <v-btn v-for="n in [3, 4, 5, 6, 7]" :key="n" :value="n" size="small">{{ n }}</v-btn>
        </v-btn-toggle>
        <v-btn icon="mdi-refresh" variant="text" title="Reset" @click="resetGame"></v-btn>
      </div>
    </div>

    <div v-if="state.message && state.status === 'FINISHED'" class="win-banner">
      <div class="win-content">
        <v-icon icon="mdi-trophy" color="warning" size="large" class="mb-2"></v-icon>
        <h2>{{ state.message }}</h2>
        <v-btn color="primary" class="mt-4" @click="resetGame">Play Again</v-btn>
      </div>
    </div>

    <div class="hanoi-board">
      <div
        v-for="(tower, tIdx) in state.towers"
        :key="tIdx"
        class="tower-slot"
        :class="{
          selected: selectedTower === tIdx,
          'can-drop': canDrop(tIdx),
          'cannot-drop':
            selectedTower !== null && selectedTower !== tIdx && !isValidMove(selectedTower, tIdx),
        }"
        @click="handleTowerClick(tIdx)"
      >
        <div class="peg"></div>
        <div class="disks-container">
          <TransitionGroup name="disk-move">
            <div
              v-for="(disk, dIdx) in tower"
              :key="`disk-${disk}`"
              class="disk"
              :style="getDiskStyle(disk, dIdx)"
              :class="{ 'top-disk': dIdx === tower.length - 1 }"
            >
              <span class="disk-label">{{ disk }}</span>
            </div>
          </TransitionGroup>
        </div>
        <div class="tower-base"></div>
      </div>
    </div>

    <div class="game-footer">
      <p v-if="selectedTower === null">Select a tower to pick up the top disk</p>
      <p v-else>
        Select target tower to move disk
        {{ state.towers[selectedTower][state.towers[selectedTower].length - 1] }}
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";
import type {
  TowerOfHanoiState,
  TowerOfHanoiAction,
} from "@engine/shared/rules/TowerOfHanoiRuleset";

const props = defineProps<{
  state: TowerOfHanoiState;
  myPlayerId?: string;
}>();

const emit = defineEmits<{ (e: "action", action: TowerOfHanoiAction): void }>();

const selectedTower = ref<number | null>(null);
const selectedDiskCount = ref(props.state.diskCount);

// Update local disk count if prop changes
watch(
  () => props.state.diskCount,
  (val) => {
    selectedDiskCount.value = val;
  },
);

const handleTowerClick = (towerIdx: number) => {
  if (props.state.status !== "PLAYING") return;

  if (selectedTower.value === null) {
    // Pick up
    if (props.state.towers[towerIdx].length > 0) {
      selectedTower.value = towerIdx;
    }
  } else if (selectedTower.value === towerIdx) {
    // Deselect
    selectedTower.value = null;
  } else {
    // Try to move
    if (isValidMove(selectedTower.value, towerIdx)) {
      emit("action", {
        type: "MOVE",
        from: selectedTower.value,
        to: towerIdx,
      });
      selectedTower.value = null;
    } else {
      // Invalid move, maybe select the new tower if it has disks?
      if (props.state.towers[towerIdx].length > 0) {
        selectedTower.value = towerIdx;
      } else {
        selectedTower.value = null;
      }
    }
  }
};

const isValidMove = (from: number, to: number): boolean => {
  const fromTower = props.state.towers[from];
  const toTower = props.state.towers[to];

  if (fromTower.length === 0) return false;
  const disk = fromTower[fromTower.length - 1];

  if (toTower.length === 0) return true;
  return disk < toTower[toTower.length - 1];
};

const canDrop = (towerIdx: number): boolean => {
  if (selectedTower.value === null || selectedTower.value === towerIdx) return false;
  return isValidMove(selectedTower.value, towerIdx);
};

const getDiskStyle = (diskSize: number, index: number) => {
  const maxWidth = 100; // % of tower-slot width
  const minWidth = 30; // % of tower-slot width
  const range = maxWidth - minWidth;
  const width = minWidth + (range * (diskSize - 1)) / (props.state.diskCount - 1 || 1);

  // Use HSL for a nice gradient across disks
  const hue = (diskSize * 137.5) % 360; // Golden angle for distribution

  return {
    width: `${width}%`,
    bottom: `${index * 24}px`, // Stack based on index
    backgroundColor: `hsl(${hue}, 70%, 60%)`,
    boxShadow: `0 4px 8px rgba(0,0,0,0.3), inset 0 2px 4px rgba(255,255,255,0.3)`,
    border: "1px solid rgba(0,0,0,0.2)",
  };
};

const resetGame = () => {
  selectedTower.value = null;
  emit("action", { type: "RESET", diskCount: selectedDiskCount.value });
};
</script>

<style scoped>
@import url("https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;800&display=swap");

.hanoi-container {
  width: 100%;
  height: 100%;
  max-width: 800px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  font-family: "Outfit", sans-serif;
  color: rgb(var(--v-theme-on-surface));
  padding: 20px;
  overflow: hidden;
  user-select: none;
}

.game-header {
  width: 100%;
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 40px;
  background: rgba(var(--v-theme-surface), 0.5);
  backdrop-filter: blur(10px);
  padding: 12px 24px;
  border-radius: 16px;
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}

.stats {
  display: flex;
  gap: 24px;
}

.stat-item {
  display: flex;
  flex-direction: column;
}

.stat-label {
  font-size: 0.7rem;
  font-weight: 800;
  letter-spacing: 1px;
  opacity: 0.6;
}

.stat-value {
  font-size: 1.5rem;
  font-weight: 800;
  color: rgb(var(--v-theme-primary));
}

.controls {
  display: flex;
  align-items: center;
  gap: 12px;
}

.hanoi-board {
  display: flex;
  justify-content: space-around;
  align-items: flex-end;
  width: 100%;
  height: 300px;
  position: relative;
  padding-bottom: 40px;
}

.tower-slot {
  flex: 1;
  height: 100%;
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-end;
  cursor: pointer;
  transition: transform 0.3s ease;
  margin: 0 10px;
  border-radius: 12px;
}

.tower-slot:hover {
  background: rgba(var(--v-theme-on-surface), 0.03);
}

.tower-slot.selected {
  background: rgba(var(--v-theme-primary), 0.1);
}

.tower-slot.can-drop {
  background: rgba(var(--v-theme-success), 0.1);
}

.tower-slot.cannot-drop {
  background: rgba(var(--v-theme-error), 0.05);
  cursor: not-allowed;
}

.peg {
  width: 12px;
  height: 200px;
  background: linear-gradient(to right, #444, #666, #444);
  border-radius: 6px 6px 0 0;
  position: absolute;
  bottom: 0;
  z-index: 1;
  box-shadow: 2px 0 5px rgba(0, 0, 0, 0.5);
}

.tower-base {
  width: 90%;
  height: 12px;
  background: #333;
  border-radius: 4px;
  position: absolute;
  bottom: -12px;
  z-index: 0;
}

.disks-container {
  width: 100%;
  height: 200px;
  position: relative;
  display: flex;
  flex-direction: column-reverse; /* Stack from bottom */
  align-items: center;
  z-index: 2;
}

.disk {
  height: 22px;
  border-radius: 11px;
  position: absolute;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275);
}

.disk-label {
  font-size: 0.7rem;
  font-weight: 800;
  color: white;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.5);
}

.selected .top-disk {
  transform: translateY(-40px) scale(1.05);
  box-shadow: 0 15px 30px rgba(0, 0, 0, 0.4);
}

/* Animations */
.disk-move-move {
  transition: all 0.4s ease;
}

.disk-move-enter-active,
.disk-move-leave-active {
  transition: all 0.4s ease;
}

.disk-move-enter-from {
  opacity: 0;
  transform: translateY(-100px);
}

.disk-move-leave-to {
  opacity: 0;
  transform: translateY(-100px);
}

.win-banner {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(var(--v-theme-background), 0.7);
  backdrop-filter: blur(8px);
  z-index: 100;
  animation: fade-in 0.5s ease-out;
}

.win-content {
  text-align: center;
  background: rgb(var(--v-theme-surface));
  padding: 40px;
  border-radius: 24px;
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
  animation: scale-up 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275);
}

.game-footer {
  margin-top: 60px;
  font-size: 0.9rem;
  opacity: 0.7;
  text-align: center;
}

@keyframes fade-in {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

@keyframes scale-up {
  from {
    transform: scale(0.8);
    opacity: 0;
  }
  to {
    transform: scale(1);
    opacity: 1;
  }
}
</style>
