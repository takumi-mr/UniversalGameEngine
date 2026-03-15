<template>
  <div class="mancala-3d-container">
    <div class="game-wrapper">

      <div class="header-info">
        <div class="score-card p2" :class="{ active: state.turn === -1 && state.status === 'PLAYING' }">
          <div class="label">P2 (Top)</div>
          <div class="score">{{ state.scores[-1] }}</div>
        </div>
        
        <div class="status-center">
          <div v-if="state.status === 'FINISHED'" class="finished-msg">GAME OVER</div>
          <div v-else class="turn-msg">{{ state.message || (state.turn === 1 ? "Player 1's Turn" : "Player 2's Turn") }}</div>
        </div>

        <div class="score-card p1" :class="{ active: state.turn === 1 && state.status === 'PLAYING' }">
          <div class="label">P1 (Bottom)</div>
          <div class="score">{{ state.scores[1] }}</div>
        </div>
      </div>

      <div ref="canvasContainer" class="board-3d-wrap"></div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue';
import type { MancalaState, MancalaAction } from '@engine/shared/rules/MancalaRuleset';
import { MancalaUI } from '../../three/MancalaUI';

const props = defineProps<{ 
  state: MancalaState,
  gameId: string,
  myPlayerId: string 
}>();
const emit = defineEmits<{ (e: 'action', action: MancalaAction): void }>();

const canvasContainer = ref<HTMLElement | null>(null);
let mancala3D: MancalaUI;

onMounted(() => {
  if (canvasContainer.value) {
    // Three.js UIの初期化
    mancala3D = new MancalaUI(
      canvasContainer.value,
      (action) => {
        // Three.js 側からのアクション（クリック）を親へemit
        emit('action', action);
      },
      props.myPlayerId
    );
    
    // 初回レンダリング
    mancala3D.renderState(props.state);
  }
});

onUnmounted(() => {
  if (mancala3D) {
    mancala3D.dispose();
  }
});

// state が更新されたら Three.js 側に通知
watch(() => props.state, (newState) => {
  if (mancala3D) {
    mancala3D.renderState(newState);
  }
}, { deep: true });
</script>

<style scoped>
@import url('https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;800&display=swap');

.mancala-3d-container {
  width: 100%;
  height: 100%;
  background: #111; /* 背景は黒一色で、3Dを際立たせる */
  font-family: 'Outfit', sans-serif;
  overflow: hidden;
}

.game-wrapper {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
}

/* ヘッダー情報（オセロのリアル版を参考に） */
.header-info {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 40px;
  padding: 20px;
  background: linear-gradient(to bottom, rgba(30, 41, 59, 0.5), transparent);
  z-index: 10;
}

.score-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 10px 20px;
  background: rgba(255, 255, 255, 0.03);
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  transition: all 0.3s ease;
  opacity: 0.6;
}
.score-card.active {
  opacity: 1;
  background: rgba(99, 102, 241, 0.1);
  border-color: rgba(99, 102, 241, 0.4);
  box-shadow: 0 0 20px rgba(99, 102, 241, 0.2);
}

.score-card .label {
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 1px;
  color: #94a3b8;
  margin-bottom: 4px;
}
.score-card .score {
  font-size: 2rem;
  font-weight: 800;
  color: #fbbf24; /* 石の色に合わせる */
  line-height: 1;
}

.status-center {
  text-align: center;
  min-width: 250px;
}
.turn-msg {
  font-size: 1.1rem;
  font-weight: 600;
  color: #e2e8f0;
}
.finished-msg {
  font-size: 1.3rem;
  font-weight: 800;
  color: #ef4444; /* 赤 */
  letter-spacing: 2px;
}

.board-3d-wrap {
  flex: 1;
  min-height: 0; /* Flexboxのバグ回避 */
}
</style>