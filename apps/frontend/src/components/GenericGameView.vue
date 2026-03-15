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
        <!-- Waiting Overlay -->
        <div v-if="gameState.status === 'WAITING'" class="waiting-overlay">
          <div class="waiting-content">
            <div class="loader-ring"></div>
            <h3>{{ $t('common.waiting_for_players') }}</h3>
            <p v-if="gameMinPlayers">
              {{ $t('common.min_players_required', { min: gameMinPlayers }) }}
              <br>
              <span class="player-count">({{ currentPlayerCount }} / {{ gameMinPlayers }})</span>
            </p>
          </div>
        </div>

        <component
          :is="gameComponent"
          v-if="gameComponent && gameState && gameState.status !== 'WAITING'"
          :state="gameState"
          :game-id="roomId"
          :my-player-id="myPlayerId"
          @action="onGameAction"
        />
        
        <!-- Fallback if no specialized component -->
        <div v-else-if="!gameComponent && gameState.status !== 'WAITING'" class="state-block">
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

        <!-- Your Turn Notification -->
        <Transition name="slide-fade">
          <div v-if="isMyTurn && gameState.status === 'PLAYING'" class="turn-notification">
            <div class="turn-content">
              <v-icon icon="mdi-star" class="turn-icon"></v-icon>
              <span>{{ $t('common.your_turn') }}</span>
            </div>
          </div>
        </Transition>
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
import { useRouter } from 'vue-router';
import { SocketIoClient } from '../network/SocketIoClient';
import { availableGames } from '../constants/games';
import type { BaseGameState, BaseGameAction } from '@engine/shared/UniversalEngine';

// 各ゲームの型をインポート
import type { TicTacToeState, TicTacToeAction } from '@engine/shared/rules/TicTacToeRuleset';
import type { OthelloState, OthelloAction } from '@engine/shared/rules/OthelloRuleset';
import type { GameState as Othello3DState, MoveAction as Othello3DAction } from '@engine/shared/rules/Othello3DRuleset';
import type { RubiksState, RubiksAction } from '@engine/shared/rules/RubicCubeRuleset';
import type { ChessState, ChessAction } from '@engine/shared/rules/ChessRuleset';
import type { EquilibriumState, EquilibriumAction } from '@engine/shared/rules/EquilibriumRuleset';
import type { ShogiState, ShogiAction } from '@engine/shared/rules/ShogiRuleset';
import type { HighLowState, DrawAction } from '@engine/shared/rules/HighLowRuleset';
import type { MancalaState, MancalaAction } from '@engine/shared/rules/MancalaRuleset';
import type { SudokuState, SudokuAction } from '@engine/shared/rules/SudokuRuleset';

// 共用体型の定義
type GameState = TicTacToeState | OthelloState | Othello3DState | RubiksState | ChessState | EquilibriumState | ShogiState | BaseGameState | HighLowState | MancalaState | SudokuState;
type GameAction = TicTacToeAction | OthelloAction | Othello3DAction | RubiksAction | ChessAction | EquilibriumAction | ShogiAction | BaseGameAction | DrawAction | MancalaAction | SudokuAction;

const props = defineProps<{
  gameType: string;
  gameEmoji: string;
  gameName: string;
  authToken: string;
  roomId: string;
}>();

defineEmits<{ (e: 'back'): void }>();

const API_BASE = 'http://127.0.0.1:3000';

const roomId          = ref(props.roomId);
const errorMsg        = ref('');
const gameState       = ref<GameState | null>(null);
const connectionStatus = ref('Connecting');

// 動的コンポーネントのマッピング
const components: Record<string, any> = {
  'tictactoe': defineAsyncComponent(() => import('./game/TicTacToe.vue')),
  'othello': defineAsyncComponent(() => import('./game/Othello.vue')),
  'othello_3d': defineAsyncComponent(() => import('./game/Othello3D.vue')),
  'shogi': defineAsyncComponent(() => import('./game/Shogi.vue')),
  'rubiks_cube': defineAsyncComponent(() => import('./game/RubiksCube.vue')),
  'chess': defineAsyncComponent(() => import('./game/Chess.vue')),
  'go': defineAsyncComponent(() => import('./game/Go.vue')),
  'equilibrium': defineAsyncComponent(() => import('./game/Equilibrium.vue')),
  'daifugo': defineAsyncComponent(() => import('./game/Daifugo/Daifugo.vue')),
  'high_low': defineAsyncComponent(() => import('./game/HighLow.vue')),
  'texas_holdem': defineAsyncComponent(() => import('./game/TexasHoldem.vue')),
  'uno': defineAsyncComponent(() => import('./game/Uno.vue')),
  'mancala': defineAsyncComponent(() => import('./game/Mancala.vue')),
  'sudoku': defineAsyncComponent(() => import('./game/Sudoku.vue')),
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

const gameMinPlayers = computed(() => {
  const game = availableGames.find(g => g.type === props.gameType);
  return game?.minPlayers ?? 0;
});

const currentPlayerCount = computed(() => {
  if (!gameState.value?.players) return 0;
  return Object.values(gameState.value.players).filter(p => p !== null).length;
});

const myPlayerId = computed(() => {
  return localStorage.getItem('game_username') || '';
});

const isMyTurn = computed(() => {
  if (!gameState.value || gameState.value.status !== 'PLAYING') return false;
  return gameState.value.activePlayers?.includes(myPlayerId.value);
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

  client.connect(props.roomId);
});

onUnmounted(() => {
  client?.disconnect();
});

const router = useRouter();

async function createNewGame() {
  try {
    connectionStatus.value = 'Creating...';
    const id = await client.createGame({ type: props.gameType.toUpperCase().replace('-', '_') });
    router.push(`/game/${props.gameType}/${id}`);
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
  background: rgb(var(--v-theme-background));
  font-family: 'Inter', sans-serif;
  color: rgb(var(--v-theme-on-background));
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
  color: rgb(var(--v-theme-primary));
}
.room-id {
  font-size: 0.8rem;
  color: rgb(var(--v-theme-on-surface));
  opacity: 0.7;
}
.room-id span {
  font-family: 'JetBrains Mono', monospace;
  color: rgb(var(--v-theme-primary));
  background: rgba(var(--v-theme-on-surface), 0.05);
  padding: 2px 6px;
  border-radius: 4px;
}

.status-pill {
  padding: 3px 10px;
  border-radius: 50px;
  font-size: 0.7rem;
  font-weight: 600;
}
.status-pill.connected    { background: rgba(var(--v-theme-success), 0.15); color: rgb(var(--v-theme-success)); }
.status-pill.disconnected { background: rgba(var(--v-theme-warning), 0.15); color: rgb(var(--v-theme-warning)); }

.error-banner {
  background: rgba(var(--v-theme-error), 0.1);
  border: 1px solid rgba(var(--v-theme-error), 0.3);
  border-radius: 10px;
  padding: 10px 16px;
  color: rgb(var(--v-theme-error));
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
  background: rgba(var(--v-theme-surface), 0.7);
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
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
  color: rgb(var(--v-theme-on-surface));
  opacity: 0.6;
}
.status-badge {
  padding: 2px 10px;
  border-radius: 50px;
  font-size: 0.75rem;
  font-weight: 700;
}
.status-badge.PLAYING  { background: rgba(var(--v-theme-primary), 0.2); color: rgb(var(--v-theme-primary)); }
.status-badge.FINISHED { background: rgba(var(--v-theme-warning), 0.2); color: rgb(var(--v-theme-warning)); }

.current-player {
  font-size: 0.9rem;
  color: rgb(var(--v-theme-on-surface));
  opacity: 0.8;
  margin-bottom: 8px;
}
.game-message {
  font-size: 1rem;
  color: rgb(var(--v-theme-secondary));
  margin-bottom: 14px;
}

.json-view {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.75rem;
  color: rgb(var(--v-theme-on-surface));
  opacity: 0.9;
  background: rgba(var(--v-theme-on-surface), 0.05);
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
  color: rgb(var(--v-theme-on-background));
  opacity: 0.6;
}
.spinner {
  width: 40px;
  height: 40px;
  border: 3px solid rgba(var(--v-theme-primary), 0.2);
  border-top-color: rgb(var(--v-theme-primary));
  border-radius: 50%;
  animation: spin 1s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }

/* === Sidebar === */
.sidebar {
  width: 240px;
  min-width: 240px;
  border-left: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  padding: 24px 16px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  overflow-y: auto;
  background: rgba(var(--v-theme-surface), 0.5);
}

.sidebar-panel {
  background: rgba(var(--v-theme-surface), 0.6);
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: 12px;
  padding: 16px;
}
.sidebar-title {
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 1px;
  color: rgb(var(--v-theme-on-surface));
  opacity: 0.6;
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
  background: rgba(var(--v-theme-on-surface), 0.05);
  color: rgb(var(--v-theme-on-surface));
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}
.back-btn:hover    { background: rgba(var(--v-theme-on-surface), 0.1); transform: translateY(-1px); }
.new-game-btn {
  background: rgb(var(--v-theme-primary));
  color: rgb(var(--v-theme-on-primary));
  box-shadow: 0 4px 12px rgba(var(--v-theme-primary), 0.3);
}
.new-game-btn:hover { opacity: 0.9; transform: translateY(-1px); box-shadow: 0 6px 16px rgba(var(--v-theme-primary), 0.4); }

.player-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 0.8rem;
  padding: 6px 0;
  border-bottom: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}
.player-row:last-child { border-bottom: none; }
.player-role { color: rgb(var(--v-theme-on-surface)); opacity: 0.8; font-weight: 600; }
.player-id   { font-family: 'JetBrains Mono', monospace; color: rgb(var(--v-theme-on-surface)); opacity: 0.6; font-size: 0.7rem; }

/* === Waiting Overlay === */
.waiting-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(var(--v-theme-background), 0.85);
  backdrop-filter: blur(8px);
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 16px;
  border: 1px solid rgba(var(--v-theme-primary), 0.2);
}

.waiting-content {
  text-align: center;
  color: rgb(var(--v-theme-on-background));
}

.waiting-content h3 {
  margin: 20px 0 10px;
  font-size: 1.5rem;
  font-weight: 700;
}

.waiting-content p {
  color: rgb(var(--v-theme-on-background));
  opacity: 0.8;
  font-size: 1rem;
}

.player-count {
  font-family: 'JetBrains Mono', monospace;
  color: rgb(var(--v-theme-primary));
  font-weight: 700;
  font-size: 1.2rem;
  margin-top: 8px;
  display: inline-block;
}

.loader-ring {
  display: inline-block;
  width: 80px;
  height: 80px;
  border: 4px solid rgba(var(--v-theme-primary), 0.1);
  border-radius: 50%;
  border-top-color: rgb(var(--v-theme-primary));
  animation: spin 1s ease-in-out infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.json-details summary {
  cursor: pointer;
  font-size: 0.75rem;
  color: rgb(var(--v-theme-on-surface));
  opacity: 0.6;
  user-select: none;
}
.json-view-mini {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.65rem;
  color: rgb(var(--v-theme-on-surface));
  opacity: 0.8;
  background: rgba(var(--v-theme-on-surface), 0.05);
  border-radius: 8px;
  padding: 10px;
  overflow: auto;
  max-height: 200px;
  margin-top: 8px;
}

/* === Turn Notification === */
.turn-notification {
  position: absolute;
  top: 20px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 1000;
  pointer-events: none;
}

.turn-content {
  background: linear-gradient(135deg, rgb(var(--v-theme-primary)), rgb(var(--v-theme-secondary)));
  color: white;
  padding: 12px 24px;
  border-radius: 50px;
  box-shadow: 0 8px 32px rgba(var(--v-theme-primary), 0.4);
  display: flex;
  align-items: center;
  gap: 12px;
  font-weight: 700;
  font-size: 1.1rem;
  letter-spacing: 0.5px;
  border: 2px solid rgba(255, 255, 255, 0.2);
}

.turn-icon {
  animation: pulse 2s infinite;
}

@keyframes pulse {
  0% { transform: scale(1); opacity: 1; }
  50% { transform: scale(1.2); opacity: 0.8; }
  100% { transform: scale(1); opacity: 1; }
}

/* Transitions */
.slide-fade-enter-active {
  transition: all 0.3s ease-out;
}
.slide-fade-leave-active {
  transition: all 0.3s cubic-bezier(1, 0.5, 0.8, 1);
}
.slide-fade-enter-from,
.slide-fade-leave-to {
  transform: translate(-50%, -20px);
  opacity: 0;
}
</style>
