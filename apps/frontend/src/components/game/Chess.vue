<template>
  <div class="chess-container" v-if="state">
    <div v-if="showPromotionDialog" class="promotion-overlay">
      <div class="promotion-modal">
        <h3>プロモーションする駒を選択</h3>
        <div class="promotion-options">
          <button @click="confirmPromotion(5)">{{ state.turn === 1 ? '♕' : '♛' }} Queen</button>
          <button @click="confirmPromotion(4)">{{ state.turn === 1 ? '♖' : '♜' }} Rook</button>
          <button @click="confirmPromotion(3)">{{ state.turn === 1 ? '♗' : '♝' }} Bishop</button>
          <button @click="confirmPromotion(2)">{{ state.turn === 1 ? '♘' : '♞' }} Knight</button>
        </div>
        <button class="cancel-btn" @click="cancelPromotion">キャンセル</button>
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
            { 'is-selected': selectedIndex === index },
            { 'is-valid-move': isValidMove(index) },
            { 'is-in-check': isKingInCheck(index) }
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
          <div v-if="isValidMove(index)" class="hint-dot"></div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from "vue";
import { ChessRuleset } from "@engine/shared/rules/ChessRuleset";
import type { ChessState, ChessAction } from "@engine/shared/rules/ChessRuleset";

const props = defineProps<{ 
  state: ChessState;
  myPlayerId?: string;
}>();

const emit = defineEmits<{ (e: 'action', action: ChessAction): void }>();

// UIのインタラクション状態
const selectedIndex = ref<number | null>(null);
const showPromotionDialog = ref<boolean>(false);
const pendingMove = ref<{ from: number, to: number } | null>(null);

// --- ヘルパー関数 ---

// Unicodeチェス駒のマッピング
const getPieceChar = (val: number): string => {
  const chars: Record<number, string> = {
     1: '♙',  2: '♘',  3: '♗',  4: '♖',  5: '♕',  6: '♔', // 白
    [-1]: '♟', [-2]: '♞', [-3]: '♝', [-4]: '♜', [-5]: '♛', [-6]: '♚'  // 黒
  };
  return chars[val] || '';
};

// チェス盤の市松模様の判定（左上 A8 が白マス(Light)になるように調整）
const isLightSquare = (index: number): boolean => {
  const x = index % 8;
  const y = Math.floor(index / 8);
  return (x + y) % 2 === 0;
};

// --- ロジック ---

// 現在選択されている駒の合法手リストを計算
const validActionsForSelected = computed<ChessAction[]>(() => {
  if (selectedIndex.value === null || !props.state || props.state.status !== 'PLAYING') return [];
  
  // 現在のターンのプレイヤーからのアクションとして取得
  const currentPlayerId = props.state.players?.[props.state.turn] || "";
  const allActions = ChessRuleset.getLegalActions(props.state, currentPlayerId);
  
  // 選択したマスからの移動のみにフィルタリング
  return allActions.filter(a => a.from === selectedIndex.value);
});

const isValidMove = (index: number): boolean => {
  return validActionsForSelected.value.some(a => a.to === index);
};

// キングがチェックされているマスを赤くするための簡易判定
const isKingInCheck = (_index: number): boolean => {
  // Engine側でCheck判定が実装されたらここを更新
  return false; 
};

// 盤面クリック時の処理
const onSquareClick = (index: number) => {
  if (!props.state || props.state.status !== 'PLAYING') return;

  // 観戦者ガード
  const isPlayer = props.state.players && Object.values(props.state.players).includes(props.myPlayerId || '');
  if (!isPlayer) return;

  const clickedPiece = props.state.board[index];

  // 1. 何も選択されていない場合、自分の駒をクリックしたら選択
  if (selectedIndex.value === null) {
    if (clickedPiece !== 0 && Math.sign(clickedPiece) === props.state.turn) {
      selectedIndex.value = index;
    }
    return;
  }

  // 2. 既に選択されている場合
  if (selectedIndex.value === index) {
    // 同じマスをクリックしたら選択解除
    selectedIndex.value = null;
    return;
  }

  if (clickedPiece !== 0 && Math.sign(clickedPiece) === props.state.turn) {
    // 別の自分の駒をクリックしたら選択を切り替え
    selectedIndex.value = index;
    return;
  }

  // 移動先の候補をクリックしたか判定
  const actions = validActionsForSelected.value.filter(a => a.to === index);
  if (actions.length > 0) {
    // プロモーション（昇格）を伴うアクションが複数（Q, R, B, N）含まれている場合
    const isPromotion = actions.some(a => a.promotion !== undefined);
    
    if (isPromotion) {
      pendingMove.value = { from: selectedIndex.value, to: index };
      showPromotionDialog.value = true;
    } else {
      // 通常の移動
      emit('action', actions[0]);
      selectedIndex.value = null;
    }
  } else {
    // 合法手ではない関係ないマスをクリックした場合は選択解除
    selectedIndex.value = null;
  }
};

// プロモーションのダイアログ処理
const confirmPromotion = (promoPiece: number) => {
  if (pendingMove.value) {
    const action: ChessAction = {
      type: 'MOVE',
      from: pendingMove.value.from,
      to: pendingMove.value.to,
      promotion: promoPiece
    };
    emit('action', action);
  }
  showPromotionDialog.value = false;
  pendingMove.value = null;
  selectedIndex.value = null;
};

const cancelPromotion = () => {
  showPromotionDialog.value = false;
  pendingMove.value = null;
  selectedIndex.value = null;
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
.error { color: rgb(var(--v-theme-error)); font-weight: bold; margin-bottom: 10px; }
.status-msg { color: rgb(var(--v-theme-warning)); font-weight: bold; font-size: 1.2em; margin-bottom: 10px; }
.color-white { color: rgb(var(--v-theme-primary)); font-weight: bold; }
.color-black { color: rgb(var(--v-theme-secondary)); font-weight: bold; }

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
  box-shadow: 0 20px 50px rgba(0,0,0,0.3);
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
  text-shadow: 1px 2px 2px rgba(0,0,0,0.5);
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
  top: 0; left: 0; width: 100vw; height: 100vh;
  background: rgba(0,0,0,0.6);
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
  box-shadow: 0 20px 60px rgba(0,0,0,0.5);
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