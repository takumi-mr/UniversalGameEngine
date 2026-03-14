<template>
  <div class="sudoku-container">
    <div class="game-wrapper">
      
      <div v-if="state.status === 'FINISHED'" class="victory-banner">
        🎉 {{ state.message || 'Sudoku Cleared!' }} 🎉
      </div>

      <div class="board-wrapper">
        <div class="sudoku-board">
          <template v-for="(row, rIndex) in state.board" :key="`row-${rIndex}`">
            <div 
              v-for="(cell, cIndex) in row" 
              :key="`cell-${rIndex}-${cIndex}`"
              class="cell"
              :class="[
                { 'is-fixed': cell.isFixed },
                { 'is-selected': isSelected(rIndex, cIndex) },
                { 'is-related': isRelated(rIndex, cIndex) },
                { 'is-same-number': isSameNumber(cell.value) },
                getBorderClasses(rIndex, cIndex)
              ]"
              @click="selectCell(rIndex, cIndex)"
            >
              {{ cell.value !== 0 ? cell.value : '' }}
            </div>
          </template>
        </div>
      </div>

      <div class="number-pad">
        <button 
          v-for="n in 9" 
          :key="n" 
          class="num-btn"
          :disabled="!canInput"
          @click="inputNumber(n)"
        >
          {{ n }}
        </button>
        <button 
          class="num-btn action-btn" 
          :disabled="!canInput"
          @click="inputNumber(0)"
        >
          ⌫
        </button>
      </div>

    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import type { SudokuState, SudokuAction } from '@engine/shared/rules/SudokuRuleset';

const props = defineProps<{ state: SudokuState }>();
const emit = defineEmits<{ (e: 'action', action: SudokuAction): void }>();

// 選択中のマスの座標
const selectedCell = ref<{ row: number; col: number } | null>(null);

// --- ヘルパー: CSSクラスの計算 ---

// 3x3ブロックの区切り線を太くするためのクラス付与
const getBorderClasses = (r: number, c: number) => {
  return {
    'border-right-thick': c === 2 || c === 5,
    'border-bottom-thick': r === 2 || r === 5,
    'border-left-thick': c === 0,
    'border-top-thick': r === 0,
    'border-right-outer': c === 8,
    'border-bottom-outer': r === 8,
  };
};

const isSelected = (r: number, c: number) => {
  return selectedCell.value?.row === r && selectedCell.value?.col === c;
};

// 選択マスと同じ行・列・3x3ブロックを薄くハイライトする
const isRelated = (r: number, c: number) => {
  if (!selectedCell.value) return false;
  const { row: sr, col: sc } = selectedCell.value;
  if (sr === r && sc === c) return false; // 選択マス自身は除く

  const isSameRow = sr === r;
  const isSameCol = sc === c;
  const isSameBlock = Math.floor(sr / 3) === Math.floor(r / 3) && Math.floor(sc / 3) === Math.floor(c / 3);

  return isSameRow || isSameCol || isSameBlock;
};

// 選択マスと同じ数字が入っているマスをハイライトする
const isSameNumber = (val: number) => {
  if (!selectedCell.value || val === 0) return false;
  const { row, col } = selectedCell.value;
  const selectedVal = props.state.board[row][col].value;
  return selectedVal !== 0 && selectedVal === val && !isSelected(row, col);
};

// --- インタラクション ---

const selectCell = (r: number, c: number) => {
  if (props.state.status !== 'PLAYING') return;
  selectedCell.value = { row: r, col: c };
};

// 入力可能か（マスが選択されており、かつ固定マスではないか）
const canInput = computed(() => {
  if (!selectedCell.value) return false;
  const { row, col } = selectedCell.value;
  return !props.state.board[row][col].isFixed && props.state.status === 'PLAYING';
});

const inputNumber = (val: number) => {
  if (!canInput.value) return;
  const { row, col } = selectedCell.value!;
  
  // エンジン側にアクションを送信（合法かどうかはエンジンの isValidAction で弾かれる）
  emit('action', {
    type: 'PLACE_NUMBER',
    row,
    col,
    value: val
  });
};

// --- キーボード操作のサポート ---

const handleKeydown = (e: KeyboardEvent) => {
  if (props.state.status !== 'PLAYING') return;

  // 数字キー入力
  if (e.key >= '1' && e.key <= '9') {
    inputNumber(parseInt(e.key, 10));
  }
  // 消去キー
  else if (e.key === 'Backspace' || e.key === 'Delete') {
    inputNumber(0);
  }
  // 矢印キーによる移動
  else if (selectedCell.value) {
    let { row, col } = selectedCell.value;
    if (e.key === 'ArrowUp') row = Math.max(0, row - 1);
    else if (e.key === 'ArrowDown') row = Math.min(8, row + 1);
    else if (e.key === 'ArrowLeft') col = Math.max(0, col - 1);
    else if (e.key === 'ArrowRight') col = Math.min(8, col + 1);

    if (row !== selectedCell.value.row || col !== selectedCell.value.col) {
      e.preventDefault();
      selectedCell.value = { row, col };
    }
  }
};

onMounted(() => {
  window.addEventListener('keydown', handleKeydown);
});

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeydown);
});
</script>

<style scoped>
@import url('https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;700&display=swap');

.sudoku-container {
  width: 100%;
  height: 100%;
  display: flex;
  justify-content: center;
  align-items: center;
  font-family: 'Outfit', sans-serif;
  padding: 20px;
}

.game-wrapper {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 24px;
  width: 100%;
  max-width: 500px;
}

.victory-banner {
  background: rgba(16, 185, 129, 0.2);
  border: 1px solid #10b981;
  color: #34d399;
  padding: 12px 24px;
  border-radius: 8px;
  font-size: 1.2rem;
  font-weight: 700;
  text-align: center;
  width: 100%;
  animation: popIn 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275);
}

/* --- 盤面 --- */
.board-wrapper {
  width: 100%;
  aspect-ratio: 1 / 1;
  background: #1e293b;
  border-radius: 4px;
  padding: 4px;
  box-shadow: 0 10px 30px rgba(0,0,0,0.5);
}

.sudoku-board {
  display: grid;
  grid-template-columns: repeat(9, 1fr);
  grid-template-rows: repeat(9, 1fr);
  width: 100%;
  height: 100%;
  background: #334155; /* 線のベース色 */
}

/* --- マス目 --- */
.cell {
  background-color: #0f172a;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: clamp(1.2rem, 5vw, 2rem);
  font-weight: 500;
  color: #60a5fa; /* 入力数字の色 */
  cursor: pointer;
  user-select: none;
  transition: background-color 0.1s;
  
  /* 基本の細い罫線 */
  border-right: 1px solid #334155;
  border-bottom: 1px solid #334155;
}

/* 固定マス（初期数字）のスタイル */
.cell.is-fixed {
  color: #f8fafc; /* 固定数字は白ではっきり表示 */
  font-weight: 700;
}

/* 3x3ブロックの太い境界線 */
.cell.border-right-thick { border-right: 2px solid #94a3b8; }
.cell.border-bottom-thick { border-bottom: 2px solid #94a3b8; }
.cell.border-left-thick { border-left: 2px solid #94a3b8; }
.cell.border-top-thick { border-top: 2px solid #94a3b8; }
.cell.border-right-outer { border-right: 2px solid #94a3b8; }
.cell.border-bottom-outer { border-bottom: 2px solid #94a3b8; }

/* ハイライト表示 */
.cell.is-related {
  background-color: #1e293b; /* 同行・同列・同ブロック */
}
.cell.is-same-number {
  background-color: rgba(96, 165, 250, 0.2); /* 同じ数字 */
}
.cell.is-selected {
  background-color: rgba(96, 165, 250, 0.4) !important; /* 選択マスは最優先 */
}

/* --- ナンバーパッド --- */
.number-pad {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 8px;
  width: 100%;
}

.num-btn {
  background: #1e293b;
  border: 1px solid #334155;
  color: #e2e8f0;
  font-size: 1.5rem;
  font-weight: 700;
  padding: 12px 0;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;
  font-family: inherit;
}
.num-btn:hover:not(:disabled) {
  background: #334155;
  border-color: #60a5fa;
  transform: translateY(-2px);
}
.num-btn:active:not(:disabled) {
  transform: translateY(0);
}
.num-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.action-btn {
  background: rgba(239, 68, 68, 0.1);
  color: #f87171;
  border-color: rgba(239, 68, 68, 0.3);
}
.action-btn:hover:not(:disabled) {
  background: rgba(239, 68, 68, 0.2);
  border-color: #f87171;
}

@keyframes popIn {
  0% { transform: scale(0.9); opacity: 0; }
  100% { transform: scale(1); opacity: 1; }
}
</style>