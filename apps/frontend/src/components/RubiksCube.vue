<template>
  <div class="rubiks-container">

    <!-- HUD -->
    <div class="hud">
      <div class="hud-panel">
        <div class="logo">🟥 Rubik's Cube</div>
        <div class="move-counter">
          <span class="label">Moves</span>
          <span class="value">{{ gameState?.moveCount ?? 0 }}</span>
        </div>
        <div class="timer-block">
          <span class="label">Time</span>
          <span class="value">{{ formattedTime }}</span>
        </div>
        <div v-if="gameState?.status === 'FINISHED'" class="solved-badge">
          🎉 Solved!
        </div>
        <div class="actions">
          <button class="btn btn-scramble" @click="scramble" :disabled="isScrambling">
            <span>🔀</span> Scramble
          </button>
          <button class="btn btn-reset" @click="reset">
            <span>🔄</span> Reset
          </button>
        </div>
      </div>

      <!-- 操作ガイド: 面のボタン -->
      <div class="hud-panel controls-panel">
        <div class="controls-title">Face Controls</div>
        <div class="face-controls">
          <template v-for="face in FACES" :key="face">
            <div class="face-row">
              <span class="face-label">{{ face }}</span>
              <button class="move-btn cw"  @click="sendRotate(face, 1)">CW ↻</button>
              <button class="move-btn ccw" @click="sendRotate(face, -1)">CCW ↺</button>
            </div>
          </template>
        </div>
      </div>
    </div>

    <!-- Three.js canvas -->
    <div ref="canvasContainer" class="canvas-wrap"></div>

    <!-- Tooltip -->
    <div class="tooltip">
      💡 Drag to rotate view · Click face arrows / buttons to turn
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue';
import { UniversalEngine } from '@engine/shared/UniversalEngine';
import { RubiksRuleset } from '@engine/shared/rules/RubicCubeRuleset';
import type { RubiksState, RubiksAction, FaceName } from '@engine/shared/rules/RubicCubeRuleset';
import { RubiksCubeUI } from '../three/RubiksCubeUI';

const FACES: FaceName[] = ['U', 'D', 'F', 'B', 'R', 'L'];

// --- State ---
const canvasContainer = ref<HTMLElement | null>(null);
const gameState      = ref<RubiksState | null>(null);
const elapsed        = ref(0);
const isScrambling   = ref(false);

let engine: UniversalEngine<RubiksState, RubiksAction>;
let threeUI: RubiksCubeUI | null = null;
let timerInterval: ReturnType<typeof setInterval> | null = null;
let startTime = 0;

// --- Computed ---
const formattedTime = computed(() => {
  const s = Math.floor(elapsed.value / 1000);
  const ms = Math.floor((elapsed.value % 1000) / 10);
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}.${String(ms).padStart(2, '0')}`;
});

// --- Engine & rendering ---
function syncState() {
  gameState.value = engine.getState();
  threeUI?.renderState(gameState.value);

  if (gameState.value.status === 'FINISHED') {
    stopTimer();
  }
}

function sendRotate(face: FaceName, direction: 1 | -1) {
  const action: RubiksAction = { type: 'ROTATE', face, direction };
  engine.dispatch(action);

  // タイマー開始 (初手のみ)
  if (gameState.value?.moveCount === 0) startTimer();

  syncState();
}

// --- Timer ---
function startTimer() {
  stopTimer();
  startTime = Date.now() - elapsed.value;
  timerInterval = setInterval(() => {
    elapsed.value = Date.now() - startTime;
  }, 50);
}

function stopTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

// --- Game control ---
function reset() {
  engine = new UniversalEngine(RubiksRuleset);
  stopTimer();
  elapsed.value = 0;
  syncState();
}

async function scramble() {
  reset();
  isScrambling.value = true;

  const MOVE_COUNT = 25;
  const faces: FaceName[] = ['U', 'D', 'F', 'B', 'R', 'L'];
  const dirs: (1 | -1)[] = [1, -1];

  for (let i = 0; i < MOVE_COUNT; i++) {
    const face = faces[Math.floor(Math.random() * faces.length)];
    const direction = dirs[Math.floor(Math.random() * dirs.length)];
    engine.dispatch({ type: 'ROTATE', face, direction });

    // 少し間を置いてアニメーション的に見せる
    await new Promise(r => setTimeout(r, 25));
    syncState();
  }

  // スクランブル後はムーブカウントをリセット
  elapsed.value = 0;
  isScrambling.value = false;
  syncState();
}

// --- Lifecycle ---
onMounted(() => {
  engine = new UniversalEngine(RubiksRuleset);

  if (canvasContainer.value) {
    threeUI = new RubiksCubeUI(canvasContainer.value, (action) => {
      if (gameState.value?.status !== 'PLAYING') return;
      engine.dispatch(action);
      if (gameState.value.moveCount === 0) startTimer();
      syncState();
    });
  }

  syncState();
});

onUnmounted(() => {
  stopTimer();
  threeUI?.dispose();
});
</script>

<style scoped>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&family=JetBrains+Mono&display=swap');

.rubiks-container {
  position: relative;
  width: 100%;
  height: 100%;
  font-family: 'Inter', sans-serif;
  overflow: hidden;
  background: #111827;
}

.canvas-wrap {
  width: 100%;
  height: 100%;
}

/* === HUD === */
.hud {
  position: absolute;
  top: 20px;
  left: 20px;
  z-index: 20;
  display: flex;
  flex-direction: column;
  gap: 12px;
  pointer-events: none;
}

.hud-panel {
  background: rgba(17, 24, 39, 0.85);
  backdrop-filter: blur(12px);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 16px;
  padding: 18px 22px;
  color: #f9fafb;
  min-width: 210px;
  box-shadow: 0 8px 32px rgba(0,0,0,0.4);
  pointer-events: auto;
}

.logo {
  font-size: 1.2rem;
  font-weight: 700;
  letter-spacing: 0.5px;
  margin-bottom: 14px;
  color: #fff;
}

.move-counter, .timer-block {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}
.label {
  font-size: 0.78rem;
  text-transform: uppercase;
  letter-spacing: 1px;
  color: #9ca3af;
}
.value {
  font-family: 'JetBrains Mono', monospace;
  font-size: 1.4rem;
  font-weight: 700;
  color: #6ee7f7;
}

.solved-badge {
  background: linear-gradient(135deg, #fbbf24, #f59e0b);
  color: #1f2937;
  font-weight: 700;
  border-radius: 10px;
  padding: 8px 12px;
  margin: 10px 0;
  text-align: center;
  font-size: 1rem;
  box-shadow: 0 0 20px rgba(251, 191, 36, 0.5);
  animation: pulse 1.2s ease-in-out infinite alternate;
}

@keyframes pulse {
  from { box-shadow: 0 0 20px rgba(251, 191, 36, 0.4); }
  to   { box-shadow: 0 0 36px rgba(251, 191, 36, 0.9); }
}

.actions {
  display: flex;
  gap: 8px;
  margin-top: 14px;
}

/* === Buttons === */
.btn {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 9px 12px;
  border-radius: 10px;
  border: none;
  cursor: pointer;
  font-size: 0.82rem;
  font-weight: 600;
  transition: all 0.18s ease;
}
.btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.btn-scramble {
  background: linear-gradient(135deg, #6366f1, #8b5cf6);
  color: white;
}
.btn-scramble:hover:not(:disabled) {
  background: linear-gradient(135deg, #818cf8, #a78bfa);
  transform: translateY(-1px);
}
.btn-reset {
  background: rgba(255,255,255,0.1);
  color: #e5e7eb;
  border: 1px solid rgba(255,255,255,0.15);
}
.btn-reset:hover {
  background: rgba(255,255,255,0.18);
  transform: translateY(-1px);
}

/* === Face Controls === */
.controls-panel {
  padding: 14px 18px;
}
.controls-title {
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 1px;
  color: #6b7280;
  margin-bottom: 10px;
}
.face-controls {
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.face-row {
  display: flex;
  align-items: center;
  gap: 6px;
}
.face-label {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.85rem;
  font-weight: 700;
  width: 18px;
  color: #facc15;
}
.move-btn {
  padding: 4px 10px;
  border-radius: 7px;
  border: none;
  font-size: 0.75rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
}
.cw {
  background: rgba(99, 102, 241, 0.3);
  color: #a5b4fc;
  border: 1px solid rgba(99, 102, 241, 0.4);
}
.cw:hover {
  background: rgba(99, 102, 241, 0.6);
  color: white;
  transform: translateY(-1px);
}
.ccw {
  background: rgba(245, 158, 11, 0.2);
  color: #fcd34d;
  border: 1px solid rgba(245, 158, 11, 0.35);
}
.ccw:hover {
  background: rgba(245, 158, 11, 0.5);
  color: white;
  transform: translateY(-1px);
}

/* === Tooltip === */
.tooltip {
  position: absolute;
  bottom: 18px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(17, 24, 39, 0.8);
  backdrop-filter: blur(8px);
  color: #9ca3af;
  font-size: 0.78rem;
  padding: 7px 18px;
  border-radius: 50px;
  border: 1px solid rgba(255,255,255,0.08);
  pointer-events: none;
  z-index: 10;
}
</style>
