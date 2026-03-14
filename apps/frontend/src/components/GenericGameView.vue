<template>
  <div class="generic-view">
    <!-- Main Game Area -->
    <div class="panel">
      <div class="panel-header">
        <div class="game-title">{{ gameEmoji }} {{ gameName }}</div>
        <div class="room-id">🔑 Room: <span>{{ roomId }}</span></div>
        <div class="status-pill" :class="statusClass">{{ connectionStatus }}</div>
      </div>

      <div v-if="errorMsg" class="error-banner">⚠️ {{ errorMsg }}</div>

      <!-- Specialized Game Component -->
      <div v-if="gameState" class="game-container">
        <component 
          :is="gameComponent" 
          v-if="gameComponent"
          :state="gameState"
          @action="onGameAction"
        />
        
        <!-- Fallback if no specialized component -->
        <div v-else class="state-block">
          <div class="state-header">
            <span class="tag">Raw Game State</span>
            <span class="status-badge" :class="gameState.status">{{ gameState.status }}</span>
          </div>
          <div v-if="gameState.activePlayers" class="current-player">
            🎯 Active: {{ gameState.activePlayers.join(', ') || '—' }}
          </div>
          <div v-if="gameState.message" class="game-message">{{ gameState.message }}</div>
          <pre class="json-view">{{ prettyState }}</pre>
        </div>
      </div>

      <div v-else class="connecting">
        <div class="spinner"></div>
        <div>Connecting to game...</div>
      </div>
    </div>

    <!-- Sidebar -->
    <div class="sidebar">
      <div class="sidebar-panel">
        <div class="sidebar-title">Controls</div>
        <button class="back-btn" @click="$emit('back')">← 選択画面へ戻る</button>
        <button class="new-game-btn" @click="createNewGame">🆕 New Game</button>
      </div>

      <!-- プレイヤーリスト -->
      <div v-if="gameState?.players" class="sidebar-panel">
        <div class="sidebar-title">Players</div>
        <div v-for="[role, id] in playerEntries" :key="role" class="player-row">
          <span class="player-role">{{ role }}</span>
          <span class="player-id">{{ id ?? 'waiting...' }}</span>
        </div>
      </div>

      <!-- デバッグ情報 -->
      <div class="sidebar-panel debug-panel">
        <div class="sidebar-title">Debug</div>
        <details class="json-details">
          <summary>📋 Raw State</summary>
          <pre class="json-view-mini">{{ prettyState }}</pre>
        </details>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, defineAsyncComponent } from 'vue';
import { SocketIoClient } from '../network/SocketIoClient';
import type { BaseGameState, BaseGameAction } from '@engine/shared/UniversalEngine';

// 各ゲームの型をインポート
import type { TicTacToeState, TicTacToeAction } from '@engine/shared/rules/TicTacToeRuleset';
import type { OthelloState, OthelloAction } from '@engine/shared/rules/OthelloRuleset';
import type { GameState as Othello3DState, MoveAction as Othello3DAction } from '@engine/shared/rules/Othello3DRuleset';
import type { RubiksState, RubiksAction } from '@engine/shared/rules/RubicCubeRuleset';
import type { ChessState, ChessAction } from '@engine/shared/rules/ChessRuleset';

// 共用体型の定義
type GameState = TicTacToeState | OthelloState | Othello3DState | RubiksState | ChessState | BaseGameState;
type GameAction = TicTacToeAction | OthelloAction | Othello3DAction | RubiksAction | ChessAction | BaseGameAction;

const props = defineProps<{
  gameType: string;
  gameEmoji: string;
  gameName: string;
  authToken: string;
}>();

defineEmits<{ (e: 'back'): void }>();

const API_BASE = 'http://127.0.0.1:3000';

const roomId          = ref('...');
const errorMsg        = ref('');
const gameState       = ref<GameState | null>(null);
const connectionStatus = ref('Connecting');

// 動的コンポーネントのマッピング
const components: Record<string, any> = {
  'tictactoe': defineAsyncComponent(() => import('./TicTacToe.vue')),
  'othello': defineAsyncComponent(() => import('./Othello.vue')),
  'othello-3d': defineAsyncComponent(() => import('./Othello3D.vue')),
  'shogi': defineAsyncComponent(() => import('./Shogi.vue')),
  'rubiks-cube': defineAsyncComponent(() => import('./RubiksCube.vue')),
  'chess': defineAsyncComponent(() => import('./Chess.vue')),
};

const gameComponent = computed(() => components[props.gameType] || null);

let client: SocketIoClient<GameState, GameAction>;

const statusClass = computed(() => ({
  connected: connectionStatus.value === 'Connected',
  disconnected: connectionStatus.value !== 'Connected',
}));

const prettyState = computed(() => JSON.stringify(gameState.value, null, 2));

const playerEntries = computed<[string, string | null][]>(() => {
  if (!gameState.value?.players) return [];
  return Object.entries(gameState.value.players) as [string, string | null][];
});

onMounted(() => {
  client = new SocketIoClient<GameState, GameAction>(API_BASE, props.authToken);
  client.onStateUpdate = (state) => {
    gameState.value = state;
    connectionStatus.value = 'Connected';
    errorMsg.value = '';
  };
  client.onError = (msg) => {
    errorMsg.value = msg;
  };

  initFromUrlOrNew();
});

onUnmounted(() => {
  client?.disconnect();
});

function initFromUrlOrNew() {
  const urlParams = new URLSearchParams(window.location.search);
  const existingId = urlParams.get('room');
  if (existingId) {
    roomId.value = existingId;
    client.connect(existingId);
  } else {
    createNewGame();
  }
}

async function createNewGame() {
  try {
    connectionStatus.value = 'Creating...';
    const id = await client.createGame({ type: props.gameType.toUpperCase().replace('-', '_') });
    roomId.value = id;
    
    // URLにルームIDを付与（共有用）
    const newUrl = new URL(window.location.href);
    newUrl.searchParams.set('room', id);
    window.history.pushState({}, '', newUrl);

    client.connect(id);
    connectionStatus.value = 'Connected';
  } catch (e) {
    errorMsg.value = 'Failed to create game';
    connectionStatus.value = 'Error';
  }
}

function onGameAction(action: GameAction) {
  client.sendAction(action);
}
</script>

<style scoped>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&family=JetBrains+Mono&display=swap');

.generic-view {
  display: flex;
  width: 100%;
  height: 100%;
  background: #0f172a;
  font-family: 'Inter', sans-serif;
  color: #e2e8f0;
  overflow: hidden;
}

/* === Main Panel === */
.panel {
  flex: 1;
  padding: 24px 32px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}

.panel-header {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 20px;
  flex-shrink: 0;
}
.game-title {
  font-size: 1.4rem;
  font-weight: 700;
  color: #f1f5f9;
}
.room-id {
  font-size: 0.8rem;
  color: #64748b;
}
.room-id span {
  font-family: 'JetBrains Mono', monospace;
  color: #94a3b8;
  background: rgba(255,255,255,0.05);
  padding: 2px 6px;
  border-radius: 4px;
}

.status-pill {
  padding: 3px 10px;
  border-radius: 50px;
  font-size: 0.7rem;
  font-weight: 600;
}
.status-pill.connected    { background: rgba(34, 197, 94, 0.15); color: #4ade80; }
.status-pill.disconnected { background: rgba(245, 158, 11, 0.15); color: #fbbf24; }

.error-banner {
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.3);
  border-radius: 10px;
  padding: 10px 16px;
  color: #f87171;
  margin-bottom: 16px;
  font-size: 0.85rem;
}

.game-container {
  flex: 1;
  min-height: 0;
  position: relative;
}

/* === Default State Block === */
.state-block {
  background: rgba(30, 41, 59, 0.7);
  border: 1px solid rgba(255,255,255,0.07);
  border-radius: 16px;
  padding: 20px 24px;
}
.state-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 14px;
}
.tag {
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 1px;
  color: #475569;
}
.status-badge {
  padding: 2px 10px;
  border-radius: 50px;
  font-size: 0.75rem;
  font-weight: 700;
}
.status-badge.PLAYING  { background: rgba(99,102,241,0.2); color: #818cf8; }
.status-badge.FINISHED { background: rgba(251,191,36,0.2); color: #fbbf24; }

.current-player {
  font-size: 0.9rem;
  color: #94a3b8;
  margin-bottom: 8px;
}
.game-message {
  font-size: 1rem;
  color: #c4b5fd;
  margin-bottom: 14px;
}

.json-view {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.75rem;
  color: #94a3b8;
  background: rgba(15, 23, 42, 0.8);
  border-radius: 10px;
  padding: 16px;
  overflow: auto;
  white-space: pre-wrap;
}

/* === Connecting === */
.connecting {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  padding-top: 80px;
  color: #64748b;
}
.spinner {
  width: 40px;
  height: 40px;
  border: 3px solid rgba(99,102,241,0.2);
  border-top-color: #6366f1;
  border-radius: 50%;
  animation: spin 1s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }

/* === Sidebar === */
.sidebar {
  width: 240px;
  min-width: 240px;
  border-left: 1px solid rgba(255,255,255,0.06);
  padding: 24px 16px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  overflow-y: auto;
  background: rgba(15, 23, 42, 0.5);
}

.sidebar-panel {
  background: rgba(30, 41, 59, 0.6);
  border: 1px solid rgba(255,255,255,0.06);
  border-radius: 12px;
  padding: 16px;
}
.sidebar-title {
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 1px;
  color: #64748b;
  margin-bottom: 12px;
  font-weight: 700;
}

.back-btn, .new-game-btn {
  width: 100%;
  padding: 10px 12px;
  border-radius: 10px;
  border: none;
  cursor: pointer;
  font-size: 0.82rem;
  font-weight: 600;
  margin-bottom: 8px;
  transition: all 0.2s ease;
}
.back-btn {
  background: rgba(255,255,255,0.05);
  color: #94a3b8;
  border: 1px solid rgba(255,255,255,0.1);
}
.back-btn:hover    { background: rgba(255,255,255,0.1); color: #e2e8f0; transform: translateY(-1px); }
.new-game-btn {
  background: linear-gradient(135deg, #6366f1, #8b5cf6);
  color: white;
  box-shadow: 0 4px 12px rgba(99, 102, 241, 0.3);
}
.new-game-btn:hover { opacity: 0.9; transform: translateY(-1px); box-shadow: 0 6px 16px rgba(99, 102, 241, 0.4); }

.player-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 0.8rem;
  padding: 6px 0;
  border-bottom: 1px solid rgba(255,255,255,0.05);
}
.player-row:last-child { border-bottom: none; }
.player-role { color: #94a3b8; font-weight: 600; }
.player-id   { font-family: 'JetBrains Mono', monospace; color: #64748b; font-size: 0.7rem; }

.json-details summary {
  cursor: pointer;
  font-size: 0.75rem;
  color: #475569;
  user-select: none;
}
.json-view-mini {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.65rem;
  color: #64748b;
  background: rgba(15, 23, 42, 0.6);
  border-radius: 8px;
  padding: 10px;
  overflow: auto;
  max-height: 200px;
  margin-top: 8px;
}
</style>
