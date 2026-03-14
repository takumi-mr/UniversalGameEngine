<template>
  <div class="generic-view">
    <div class="panel">
      <div class="panel-header">
        <div class="game-title">{{ gameEmoji }} {{ gameName }}</div>
        <div class="room-id">🔑 Room: <span>{{ roomId }}</span></div>
        <div class="status-pill" :class="statusClass">{{ connectionStatus }}</div>
      </div>

      <div v-if="errorMsg" class="error-banner">⚠️ {{ errorMsg }}</div>

      <div v-if="gameState" class="state-block">
        <div class="state-header">
          <span class="tag">Game State</span>
          <span class="status-badge" :class="gameState.status">{{ gameState.status }}</span>
        </div>

        <!-- ターン情報 -->
        <div v-if="gameState.activePlayers" class="current-player">
          🎯 Active: {{ gameState.activePlayers.join(', ') || '—' }}
        </div>
        <div v-if="gameState.message" class="game-message">{{ gameState.message }}</div>

        <!-- 生のJSONデバッグView (折りたたみ可能) -->
        <details class="json-details">
          <summary>📋 Raw State</summary>
          <pre class="json-view">{{ prettyState }}</pre>
        </details>
      </div>

      <div v-else class="connecting">
        <div class="spinner"></div>
        <div>Connecting to game...</div>
      </div>
    </div>

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
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { SocketIoClient } from '../network/SocketIoClient';

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
const gameState       = ref<any>(null);
const connectionStatus = ref('Connecting');

let client: SocketIoClient<any, any>;

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
  client = new SocketIoClient(API_BASE, props.authToken);
  client.onStateUpdate = (state) => {
    gameState.value = state;
    connectionStatus.value = 'Connected';
    errorMsg.value = '';
  };
  client.onError = (msg) => {
    errorMsg.value = msg;
  };

  createNewGame();
});

onUnmounted(() => {
  client?.disconnect();
});

async function createNewGame() {
  try {
    connectionStatus.value = 'Creating...';
    const id = await client.createGame({ type: props.gameType });
    roomId.value = id;
    connectionStatus.value = 'Connected';
  } catch (e) {
    errorMsg.value = 'Failed to create game';
    connectionStatus.value = 'Error';
  }
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
  padding: 28px 32px;
  overflow-y: auto;
}

.panel-header {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 24px;
  flex-wrap: wrap;
}
.game-title {
  font-size: 1.6rem;
  font-weight: 700;
  color: #f1f5f9;
}
.room-id {
  font-size: 0.85rem;
  color: #64748b;
}
.room-id span {
  font-family: 'JetBrains Mono', monospace;
  color: #94a3b8;
}

.status-pill {
  padding: 4px 12px;
  border-radius: 50px;
  font-size: 0.75rem;
  font-weight: 600;
}
.status-pill.connected    { background: rgba(34, 197, 94, 0.15); color: #4ade80; }
.status-pill.disconnected { background: rgba(245, 158, 11, 0.15); color: #fbbf24; }

.error-banner {
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.3);
  border-radius: 10px;
  padding: 12px 18px;
  color: #f87171;
  margin-bottom: 18px;
}

/* === State Block === */
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

.json-details summary {
  cursor: pointer;
  font-size: 0.8rem;
  color: #475569;
  margin-bottom: 8px;
  user-select: none;
}
.json-view {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.72rem;
  color: #94a3b8;
  background: rgba(15, 23, 42, 0.8);
  border-radius: 10px;
  padding: 14px;
  overflow: auto;
  max-height: 400px;
  white-space: pre-wrap;
}

/* === Connecting === */
.connecting {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  padding-top: 60px;
  color: #64748b;
}
.spinner {
  width: 36px;
  height: 36px;
  border: 3px solid rgba(99,102,241,0.2);
  border-top-color: #6366f1;
  border-radius: 50%;
  animation: spin 1s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }

/* === Sidebar === */
.sidebar {
  width: 220px;
  min-width: 220px;
  border-left: 1px solid rgba(255,255,255,0.06);
  padding: 24px 16px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  overflow-y: auto;
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
  color: #475569;
  margin-bottom: 12px;
}

.back-btn, .new-game-btn {
  width: 100%;
  padding: 9px 12px;
  border-radius: 9px;
  border: none;
  cursor: pointer;
  font-size: 0.82rem;
  font-weight: 600;
  margin-bottom: 8px;
  transition: all 0.15s ease;
}
.back-btn {
  background: rgba(255,255,255,0.06);
  color: #94a3b8;
  border: 1px solid rgba(255,255,255,0.08);
}
.back-btn:hover    { background: rgba(255,255,255,0.12); color: #e2e8f0; }
.new-game-btn {
  background: linear-gradient(135deg, #6366f1, #8b5cf6);
  color: white;
}
.new-game-btn:hover { opacity: 0.85; }

.player-row {
  display: flex;
  justify-content: space-between;
  font-size: 0.8rem;
  padding: 5px 0;
  border-bottom: 1px solid rgba(255,255,255,0.05);
}
.player-row:last-child { border-bottom: none; }
.player-role { color: #64748b; }
.player-id   { font-family: 'JetBrains Mono', monospace; color: #94a3b8; font-size: 0.72rem; }
</style>
