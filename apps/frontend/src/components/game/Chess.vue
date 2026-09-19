<template>
  <div v-if="state" class="chess-container">
    <div v-if="pending" class="promotion-overlay">
      <div class="promotion-modal">
        <h3>プロモーションする駒を選択</h3>
        <div class="promotion-options">
          <button
            v-for="option in pending"
            :key="option.promotion"
            @click="choosePromotion(option)"
          >
            {{ getPieceChar((option.promotion ?? 0) * state.turn) }}
            {{ PROMOTION_NAMES[option.promotion ?? 0] }}
          </button>
        </div>
        <button class="cancel-btn" @click="cancelPromotion()">キャンセル</button>
      </div>
    </div>

    <div class="board-wrapper">
      <div class="chess-board">
        <div
          v-for="(_, index) in 64"
          :key="`cell-${index}`"
          class="cell"
          :class="[
            isLightSquare(index) ? 'light-square' : 'dark-square',
            { 'is-selected': selected === index },
            { 'is-valid-move': isTarget(index) },
            { 'is-in-check': isKingInCheck(index) },
          ]"
          @click="onSquareClick(index)"
        >
          <span
            v-if="state.board[index] !== 0"
            class="piece"
            :class="state.board[index] > 0 ? 'piece-white' : 'piece-black'"
          >
            {{ getPieceChar(state.board[index]) }}
          </span>
          <div v-if="isTarget(index)" class="hint-dot" />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ChessRuleset } from "@engine/shared/rules/ChessRuleset";
import type { ChessState, ChessAction } from "@engine/shared/rules/ChessRuleset";
import { useGameSession } from "@/composables/useGameSession";
import { useSelectAndMove } from "@/composables/useSelectAndMove";

const props = defineProps<{
  state: ChessState;
  myPlayerId?: string;
}>();

const emit = defineEmits<{ (e: "action", action: ChessAction): void }>();

const { legalActions, send } = useGameSession(props, emit, ChessRuleset);
// 駒選択 → 移動先 → （昇格なら）駒種選択。すべて合法手リストから判定する
const {
  selected,
  pending,
  isTarget,
  click: onSquareClick,
  choose: choosePromotion,
  cancel: cancelPromotion,
} = useSelectAndMove(legalActions, send);

// --- ヘルパー関数 ---

// Unicodeチェス駒のマッピング
const getPieceChar = (val: number): string => {
  const chars: Record<number, string> = {
    1: "♙",
    2: "♘",
    3: "♗",
    4: "♖",
    5: "♕",
    6: "♔", // 白
    [-1]: "♟",
    [-2]: "♞",
    [-3]: "♝",
    [-4]: "♜",
    [-5]: "♛",
    [-6]: "♚", // 黒
  };
  return chars[val] || "";
};

const PROMOTION_NAMES: Record<number, string> = {
  5: "Queen",
  4: "Rook",
  3: "Bishop",
  2: "Knight",
};

// チェス盤の市松模様の判定（左上 A8 が白マス(Light)になるように調整）
const isLightSquare = (index: number): boolean => {
  const x = index % 8;
  const y = Math.floor(index / 8);
  return (x + y) % 2 === 0;
};

// キングがチェックされているマスを赤くするための簡易判定
const isKingInCheck = (_index: number): boolean => {
  // Engine側でCheck判定が実装されたらここを更新
  return false;
};
</script>

<style scoped>
/* 基本レイアウト */
.chess-container {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}
.ui-layer {
  position: absolute;
  top: 15px;
  left: 15px;
  z-index: 10;
}
.panel {
  background: rgba(var(--v-theme-surface), 0.9);
  color: rgb(var(--v-theme-on-surface));
  padding: 15px;
  border-radius: 12px;
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  min-width: 250px;
}
.room-info button {
  background: rgb(var(--v-theme-primary));
  border: none;
  color: rgb(var(--v-theme-on-primary));
  padding: 4px 10px;
  margin-left: 10px;
  cursor: pointer;
  border-radius: 4px;
}
.error {
  color: rgb(var(--v-theme-error));
  font-weight: bold;
  margin-bottom: 10px;
}
.status-msg {
  color: rgb(var(--v-theme-warning));
  font-weight: bold;
  font-size: 1.2em;
  margin-bottom: 10px;
}
.color-white {
  color: rgb(var(--v-theme-primary));
  font-weight: bold;
}
.color-black {
  color: rgb(var(--v-theme-secondary));
  font-weight: bold;
}

/* チェス盤面 */
.board-wrapper {
  width: 100%;
  max-width: 600px;
  padding: 20px;
}
.chess-board {
  display: grid;
  grid-template-columns: repeat(8, 1fr);
  grid-template-rows: repeat(8, 1fr);
  aspect-ratio: 1 / 1;
  border: 4px solid rgba(var(--v-theme-on-surface), 0.1);
  background-color: rgba(var(--v-theme-on-surface), 0.05);
  box-shadow: 0 20px 50px rgba(0, 0, 0, 0.3);
  border-radius: 8px;
}

/* マス目 (市松模様) */
.cell {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  user-select: none;
}
.light-square {
  background-color: rgba(var(--v-theme-on-surface), 0.05);
}
.dark-square {
  background-color: rgba(var(--v-theme-on-surface), 0.15);
}

/* インタラクション (選択・ハイライト) */
.is-selected {
  background-color: rgba(var(--v-theme-primary), 0.4) !important;
}
.is-valid-move {
  cursor: pointer;
}
.is-valid-move:hover {
  background-color: rgba(0, 0, 0, 0.1);
}

/* 合法手のヒントドット */
.hint-dot {
  position: absolute;
  width: 25%;
  height: 25%;
  background-color: rgba(0, 0, 0, 0.2);
  border-radius: 50%;
  pointer-events: none;
}

/* 駒 (Unicode) */
.piece {
  font-size: 4.5rem; /* サイズは適宜調整 */
  line-height: 1;
  cursor: pointer;
  /* 影をつけることで、単なる文字ではなく立体的な駒っぽく見せる */
  text-shadow: 1px 2px 2px rgba(0, 0, 0, 0.5);
  transition: transform 0.1s ease;
}
.cell:active .piece {
  transform: translateY(2px);
}
.piece-white {
  color: rgb(var(--v-theme-primary));
  text-shadow: 0 0 10px rgba(var(--v-theme-primary), 0.3);
}
.piece-black {
  color: rgb(var(--v-theme-secondary));
  text-shadow: 0 0 10px rgba(var(--v-theme-secondary), 0.3);
}

/* プロモーション・ダイアログ */
.promotion-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}
.promotion-modal {
  background: rgb(var(--v-theme-surface));
  color: rgb(var(--v-theme-on-surface));
  padding: 24px;
  border-radius: 16px;
  text-align: center;
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
}
.promotion-options {
  display: flex;
  gap: 10px;
  margin: 20px 0;
  justify-content: center;
}
.promotion-options button {
  font-size: 2rem;
  padding: 12px 24px;
  cursor: pointer;
  background: rgba(var(--v-theme-on-surface), 0.05);
  color: rgb(var(--v-theme-on-surface));
  border: 2px solid rgba(var(--v-theme-on-surface), 0.1);
  border-radius: 12px;
  transition: all 0.2s;
}
.promotion-options button:hover {
  background: rgba(var(--v-theme-primary), 0.1);
  border-color: rgb(var(--v-theme-primary));
}
.cancel-btn {
  padding: 10px 20px;
  background: rgba(var(--v-theme-error), 0.1);
  color: rgb(var(--v-theme-error));
  border: 1px solid rgba(var(--v-theme-error), 0.3);
  border-radius: 8px;
  cursor: pointer;
  font-weight: 600;
  transition: all 0.2s;
}
.cancel-btn:hover {
  background: rgba(var(--v-theme-error), 0.2);
}
</style>
