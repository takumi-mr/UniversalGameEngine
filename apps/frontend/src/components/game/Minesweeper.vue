<template>
  <div class="minesweeper-container">
    <div class="board-wrapper">
      <div class="game-message" v-if="state.message">
        {{ state.message }}
      </div>

      <div class="minesweeper-board-container">
        <div 
          class="minesweeper-board" 
          :style="gridStyle"
        >
          <template v-for="(row, r) in state.board" :key="`row-${r}`">
            <div 
              v-for="(cell, c) in row" 
              :key="`cell-${r}-${c}`"
              class="cell"
              :class="{
                'revealed': cell.isRevealed,
                'hidden': !cell.isRevealed,
                'flagged': !cell.isRevealed && cell.isFlagged,
                'mine': cell.isRevealed && cell.secret.isMine,
                ['number-' + (cell.secret.neighborMines || 0)]: cell.isRevealed && !cell.secret.isMine && cell.secret.neighborMines !== undefined,
                'game-over': state.status === 'FINISHED'
              }"
              @click.left="handleLeftClick(r, c)"
              @contextmenu.prevent="handleRightClick(r, c)"
            >
              <Transition name="fade" mode="out-in">
                <!-- Revealed content -->
                <div v-if="cell.isRevealed" class="cell-content revealed-content">
                  <span v-if="cell.secret.isMine" class="bomb-icon">💣</span>
                  <span v-else-if="cell.secret.neighborMines && cell.secret.neighborMines > 0" class="number">
                    {{ cell.secret.neighborMines }}
                  </span>
                </div>
                <!-- Hidden content -->
                <div v-else class="cell-content hidden-content">
                  <span v-if="cell.isFlagged" class="flag-icon">🚩</span>
                </div>
              </Transition>
            </div>
          </template>
        </div>
      </div>
      
      <!-- Controls / Info -->
      <div class="controls-panel">
        <div class="info-pill">
          <span class="icon">💣</span>
          <span class="value">{{ mineCountDisplay }} / {{ state.mineCount }}</span>
        </div>
        <div class="rules-hint">
          Left-click to reveal. Right-click to flag.
        </div>
      </div>

      <div v-if="state.status === 'FINISHED'" class="result-overlay">
        <div class="result-content">
          <div class="winner-text">{{ state.message }}</div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { MinesweeperState, MinesweeperAction } from "@engine/shared/rules/MinesweeperRuleset";

const props = defineProps<{ 
  state: MinesweeperState,
  myPlayerId?: string 
}>();

const emit = defineEmits<{ (e: 'action', action: MinesweeperAction): void }>();

const isSpectator = computed(() => {
  if (!props.state.players) return true;
  return !Object.values(props.state.players).includes(props.myPlayerId || '');
});

const isGameActive = computed(() => props.state.status === 'PLAYING' || props.state.status === 'INITIALIZED');

const handleLeftClick = (row: number, col: number) => {
  if (isSpectator.value || !isGameActive.value) return;
  const cell = props.state.board[row][col];
  
  // Can only reveal unrevealed, unflagged cells
  if (!cell.isRevealed && !cell.isFlagged) {
    emit('action', { type: 'REVEAL', row, col });
  }
};

const handleRightClick = (row: number, col: number) => {
  if (isSpectator.value || !isGameActive.value) return;
  const cell = props.state.board[row][col];
  
  // Can only flag unrevealed cells
  if (!cell.isRevealed) {
    emit('action', { type: 'FLAG', row, col });
  }
};

const gridStyle = computed(() => {
  return {
    gridTemplateColumns: `repeat(${props.state.cols}, minmax(30px, 1fr))`,
    gridTemplateRows: `repeat(${props.state.rows}, minmax(30px, 1fr))`
  };
});

const mineCountDisplay = computed(() => {
  let flaggedCount = 0;
  for (let r = 0; r < props.state.rows; r++) {
    for (let c = 0; c < props.state.cols; c++) {
      if (props.state.board[r][c].isFlagged && !props.state.board[r][c].isRevealed) {
        flaggedCount++;
      }
    }
  }
  return flaggedCount;
});
</script>

<style scoped>
@import url('https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;800&family=JetBrains+Mono:wght@700&display=swap');

.minesweeper-container {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: 'Outfit', sans-serif;
  perspective: 1000px;
  overflow: auto;
  padding: 20px;
}

.board-wrapper {
  position: relative;
  width: fit-content;
  max-width: 100%;
  display: flex;
  flex-direction: column;
  gap: 20px;
  align-items: center;
}

.game-message {
  text-align: center;
  font-size: 1.2rem;
  font-weight: 700;
  color: rgb(var(--v-theme-primary));
  text-shadow: 0 0 10px rgba(var(--v-theme-primary), 0.3);
  min-height: 1.5em;
  padding: 8px 24px;
  background: rgba(var(--v-theme-surface), 0.6);
  border-radius: 50px;
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}

.controls-panel {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  margin-top: 10px;
}

.info-pill {
  display: flex;
  align-items: center;
  gap: 8px;
  background: rgba(var(--v-theme-surface), 0.8);
  padding: 8px 16px;
  border-radius: 50px;
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  box-shadow: 0 4px 12px rgba(0,0,0,0.1);
}

.info-pill .icon {
  font-size: 1.2rem;
}

.info-pill .value {
  font-family: 'JetBrains Mono', monospace;
  font-size: 1.1rem;
  font-weight: 700;
  color: rgb(var(--v-theme-on-surface));
}

.rules-hint {
  font-size: 0.85rem;
  opacity: 0.6;
  color: rgb(var(--v-theme-on-surface));
}

.minesweeper-board-container {
  max-width: 100%;
  overflow: auto;
  padding: 10px;
  border-radius: 16px;
  background: rgba(var(--v-theme-surface), 0.3);
  box-shadow: inset 0 2px 10px rgba(0,0,0,0.1);
}

.minesweeper-board {
  display: grid;
  gap: 4px;
  padding: 8px;
  background: rgba(var(--v-theme-on-surface), 0.1);
  backdrop-filter: blur(12px);
  border-radius: 12px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.2);
  box-shadow: 0 15px 35px rgba(0,0,0,0.3);
}

/* Base cell styling */
.cell {
  aspect-ratio: 1 / 1;
  width: clamp(24px, 4vw, 42px);
  min-width: 24px;
  min-height: 24px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  cursor: pointer;
  user-select: none;
  transition: all 0.2s cubic-bezier(0.25, 0.46, 0.45, 0.94);
  font-family: 'JetBrains Mono', monospace;
  font-weight: 700;
  font-size: clamp(0.8rem, 2vw, 1.2rem);
}

/* Hidden state (Covered) */
.cell.hidden {
  background: linear-gradient(135deg, rgba(var(--v-theme-surface), 0.8), rgba(var(--v-theme-surface), 0.4));
  border-top: 2px solid rgba(255, 255, 255, 0.15);
  border-left: 2px solid rgba(255, 255, 255, 0.15);
  border-right: 2px solid rgba(0, 0, 0, 0.2);
  border-bottom: 2px solid rgba(0, 0, 0, 0.2);
  box-shadow: inset 0 2px 4px rgba(255,255,255,0.05), 0 2px 4px rgba(0,0,0,0.15);
}

.cell.hidden:hover:not(.game-over) {
  background: linear-gradient(135deg, rgba(var(--v-theme-surface), 1), rgba(var(--v-theme-surface), 0.6));
  transform: translateY(-1px);
  box-shadow: inset 0 2px 4px rgba(255,255,255,0.1), 0 4px 8px rgba(0,0,0,0.2);
}

.cell.hidden:active:not(.game-over) {
  transform: translateY(1px);
  border-top: 2px solid rgba(0, 0, 0, 0.2);
  border-left: 2px solid rgba(0, 0, 0, 0.2);
  border-right: 2px solid rgba(255, 255, 255, 0.1);
  border-bottom: 2px solid rgba(255, 255, 255, 0.1);
}

.cell.flagged {
  /* Flagged animation/styling if needed */
}

/* Revealed state (Uncovered) */
.cell.revealed {
  background: rgba(var(--v-theme-background), 0.4);
  border: 1px solid rgba(0, 0, 0, 0.1);
  box-shadow: inset 0 2px 5px rgba(0,0,0,0.1) !important;
  cursor: default;
}

/* If revealed and mine (Game over usually happens) */
.cell.mine {
  background: rgba(var(--v-theme-error), 0.4);
  border-color: rgb(var(--v-theme-error));
  animation: pulse-error 1.5s infinite;
}

@keyframes pulse-error {
  0% { box-shadow: 0 0 0 0 rgba(var(--v-theme-error), 0.7); }
  70% { box-shadow: 0 0 0 6px rgba(var(--v-theme-error), 0); }
  100% { box-shadow: 0 0 0 0 rgba(var(--v-theme-error), 0); }
}

/* Content wrapper */
.cell-content {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
}

.hidden-content {
  text-shadow: 0 2px 4px rgba(0,0,0,0.3);
}

/* Numbers Colors */
.number-1 .number { color: #3b82f6; text-shadow: 0 0 8px rgba(59, 130, 246, 0.4); } /* Blue */
.number-2 .number { color: #10b981; text-shadow: 0 0 8px rgba(16, 185, 129, 0.4); } /* Green */
.number-3 .number { color: #ef4444; text-shadow: 0 0 8px rgba(239, 68, 68, 0.4); } /* Red */
.number-4 .number { color: #8b5cf6; text-shadow: 0 0 8px rgba(139, 92, 246, 0.4); } /* Purple */
.number-5 .number { color: #f59e0b; text-shadow: 0 0 8px rgba(245, 158, 11, 0.4); } /* Amber */
.number-6 .number { color: #06b6d4; text-shadow: 0 0 8px rgba(6, 182, 212, 0.4); } /* Cyan */
.number-7 .number { color: #f43f5e; text-shadow: 0 0 8px rgba(244, 63, 94, 0.4); } /* Rose */
.number-8 .number { color: #57534e; text-shadow: 0 0 8px rgba(87, 83, 78, 0.4); }  /* Stone */

/* Result Overlay */
.result-overlay {
  position: absolute;
  top: 0; left: 0; right: 0; bottom: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(var(--v-theme-background), 0.3);
  backdrop-filter: blur(4px);
  z-index: 100;
  pointer-events: none;
  border-radius: 20px;
}

.result-content {
  background: rgb(var(--v-theme-surface));
  padding: 24px 40px;
  border-radius: 20px;
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  box-shadow: 0 10px 40px rgba(0,0,0,0.5);
  animation: slide-up 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275);
}

.winner-text {
  font-size: 1.5rem;
  font-weight: 800;
  color: rgb(var(--v-theme-on-surface));
  text-align: center;
}

@keyframes slide-up {
  from { transform: translateY(30px) scale(0.9); opacity: 0; }
  to { transform: translateY(0) scale(1); opacity: 1; }
}

/* Fade Transition for cell reveals */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.15s ease, transform 0.15s ease;
}

.fade-enter-from {
  opacity: 0;
  transform: scale(0.5);
}

.fade-leave-to {
  opacity: 0;
  transform: scale(1.2);
}
</style>
