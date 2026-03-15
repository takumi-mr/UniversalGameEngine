<template>
  <div class="tictactoe-container">
    <div class="board-wrapper">
      <div class="status-indicator">
        <div v-if="state.status === 'PLAYING'" class="turn-box" :class="{ 'active': state.turn === 1 }">
          <span class="symbol">O</span>
          <span class="label">Player 1</span>
        </div>
        <div class="vs">VS</div>
        <div v-if="state.status === 'PLAYING'" class="turn-box" :class="{ 'active': state.turn === -1 }">
          <span class="symbol">X</span>
          <span class="label">Player 2</span>
        </div>
      </div>

      <div class="game-message" v-if="state.message">{{ state.message }}</div>

      <div class="tictactoe-board">
        <div 
          v-for="(cell, index) in state.board" 
          :key="`cell-${index}`" 
          class="cell"
          :class="{ 
            'is-clickable': isClickable(index),
            'winning-cell': isWinningCell(index)
          }"
          @click="placePiece(index)"
        >
          <Transition name="pop">
            <span v-if="cell === 1" class="piece piece-o">O</span>
            <span v-else-if="cell === -1" class="piece piece-x">X</span>
          </Transition>
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
import type { TicTacToeState, TicTacToeAction } from "@engine/shared/rules/TicTacToeRuleset";

const props = defineProps<{ 
  state: TicTacToeState,
  myPlayerId?: string 
}>();
const emit = defineEmits<{ (e: 'action', action: TicTacToeAction): void }>();

// 勝利マスのハイライト（シンプルに盤面がいっぱいかチェックするロジックなどはバックエンドにあるため、
// 本来的にはバックエンドから勝利ラインが送られてくるのが理想。今回は暫定的に表示のみ。）
const isWinningCell = (_index: number) => {
  return false; // バックエンドから情報が来るまで一旦無効
};

const isClickable = (index: number): boolean => {
  if (props.state.status !== 'PLAYING') return false;
  // 自分がプレイヤーリストに含まれているかチェック
  const isPlayer = props.state.players && Object.values(props.state.players).includes(props.myPlayerId || '');
  if (!isPlayer) return false;
  
  return props.state.board[index] === 0;
};

const placePiece = (index: number) => {
  if (!isClickable(index)) return;
  emit('action', { type: 'PLACE', index });
};
</script>

<style scoped>
@import url('https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;800&display=swap');

.tictactoe-container {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: 'Outfit', sans-serif;
  perspective: 1000px;
}

.board-wrapper {
  width: 100%;
  max-width: 480px;
  display: flex;
  flex-direction: column;
  gap: 24px;
  padding: 20px;
}

/* === Status Indicator === */
.status-indicator {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 32px;
}
.turn-box {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  opacity: 0.3;
  transition: all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275);
}
.turn-box.active {
  opacity: 1;
  transform: scale(1.1);
}
.turn-box .symbol {
  font-size: 2rem;
  font-weight: 800;
}
.turn-box .label {
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 1px;
}
.active.turn-box:nth-child(1) .symbol { color: #00f2fe; text-shadow: 0 0 15px rgba(0, 242, 254, 0.6); }
.active.turn-box:nth-child(3) .symbol { color: #f000ff; text-shadow: 0 0 15px rgba(240, 0, 255, 0.6); }

.vs {
  font-weight: 800;
  color: rgb(var(--v-theme-on-surface));
  opacity: 0.5;
  font-size: 0.9rem;
}

.game-message {
  text-align: center;
  font-size: 1.1rem;
  font-weight: 600;
  color: rgb(var(--v-theme-secondary));
  text-shadow: 0 0 10px rgba(var(--v-theme-secondary), 0.3);
  min-height: 1.5em;
}

/* === Board === */
.tictactoe-board {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  grid-template-rows: repeat(3, 1fr);
  aspect-ratio: 1 / 1;
  gap: 12px;
  padding: 12px;
  background: rgba(var(--v-theme-on-surface), 0.03);
  backdrop-filter: blur(8px);
  border-radius: 24px;
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  box-shadow: 0 20px 50px rgba(0,0,0,0.3);
}

.cell {
  background: rgba(var(--v-theme-surface), 0.6);
  border-radius: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  transition: all 0.2s ease;
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  cursor: default;
}

.cell.is-clickable {
  cursor: pointer;
}
.cell.is-clickable:hover {
  background: rgba(var(--v-theme-on-surface), 0.06);
  border-color: rgba(var(--v-theme-on-surface), 0.1);
  transform: translateY(-2px);
}
.cell.is-clickable:active {
  transform: scale(0.95);
}

.piece {
  font-size: 4rem;
  font-weight: 800;
  user-select: none;
}
.piece-o {
  color: rgb(var(--v-theme-primary));
  background: linear-gradient(135deg, rgb(var(--v-theme-primary)) 0%, rgb(var(--v-theme-secondary)) 100%);
  background-clip: text;
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  filter: drop-shadow(0 0 8px rgba(var(--v-theme-primary), 0.4));
}
.piece-x {
  color: rgb(var(--v-theme-secondary));
  background: linear-gradient(135deg, rgb(var(--v-theme-secondary)) 0%, rgb(var(--v-theme-primary)) 100%);
  background-clip: text;
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  filter: drop-shadow(0 0 8px rgba(var(--v-theme-secondary), 0.4));
}

/* === Animations === */
.pop-enter-active {
  animation: pop-in 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275);
}
@keyframes pop-in {
  0% { transform: scale(0.2); opacity: 0; filter: blur(10px); }
  100% { transform: scale(1); opacity: 1; filter: blur(0); }
}

/* === Result Overlay === */
.result-overlay {
  position: absolute;
  top: 0; left: 0; right: 0; bottom: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(var(--v-theme-background), 0.2);
  backdrop-filter: blur(4px);
  z-index: 100;
  pointer-events: none;
  border-radius: 24px;
}
.result-content {
  background: rgb(var(--v-theme-surface));
  padding: 24px 40px;
  border-radius: 20px;
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  box-shadow: 0 10px 40px rgba(0,0,0,0.5);
  animation: slide-up 0.5s ease-out;
}
.winner-text {
  font-size: 1.5rem;
  font-weight: 800;
  color: rgb(var(--v-theme-on-surface));
}

@keyframes slide-up {
  from { transform: translateY(20px); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
}
</style>