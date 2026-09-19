<template>
  <div class="generic-view">
    <!-- Main Game Area -->
    <div class="panel">
      <div class="panel-header">
        <div class="game-title">{{ gameEmoji }} {{ $t(`games.${gameType}.name`) }}</div>
        <div class="room-id">
          🔑 Room: <span>{{ roomId }}</span>
        </div>
        <div class="status-pill" :class="statusClass">
          {{ connectionStatus }}
        </div>
      </div>

      <div v-if="errorMsg" class="error-banner">⚠️ {{ errorMsg }}</div>

      <!-- Specialized Game Component -->
      <div v-if="gameState" class="game-container">
        <!-- Waiting Overlay -->
        <div v-if="gameState.status === 'WAITING'" class="waiting-overlay">
          <div class="waiting-content">
            <div class="loader-ring" />
            <h3>{{ $t("common.waiting_for_players") }}</h3>
            <p v-if="gameMinPlayers">
              {{ $t("common.min_players_required", { min: gameMinPlayers }) }}
              <br />
              <span class="player-count">{{ currentPlayerCount }} / {{ gameMinPlayers }}</span>
            </p>
            <div class="waiting-subtext">
              Game will start automatically when enough players join.
            </div>
          </div>
        </div>

        <component
          :is="gameComponent"
          v-if="gameComponent && gameState && gameState.status !== 'WAITING'"
          :state="gameState"
          :game-id="roomId"
          :my-player-id="myPlayerId"
          :clock-skew="clockSkew"
          @action="onGameAction"
        />

        <!-- Fallback if no specialized component -->
        <div v-else-if="!gameComponent && gameState.status !== 'WAITING'" class="state-block">
          <div class="state-header">
            <span class="tag">Raw Game State</span>
            <span class="status-badge" :class="gameState.status">{{ gameState.status }}</span>
          </div>
          <div v-if="gameState.activePlayers" class="current-player">
            🎯 Active: {{ gameState.activePlayers.join(", ") || "—" }}
          </div>
          <div v-if="gameState.message" class="game-message">
            {{ gameState.message }}
          </div>
          <pre class="json-view">{{ prettyState }}</pre>
        </div>

        <!-- 手番の締切カウントダウン -->
        <div
          v-if="remainingSeconds !== null && gameState.status === 'PLAYING'"
          class="deadline-badge"
          :class="{ urgent: remainingSeconds <= 5 }"
        >
          ⏱ {{ remainingSeconds }}s
        </div>

        <!-- Your Turn Notification -->
        <Transition name="slide-fade">
          <div v-if="isMyTurn && gameState.status === 'PLAYING'" class="turn-notification">
            <div class="turn-content">
              <v-icon icon="mdi-star" class="turn-icon" />
              <span>{{ $t("common.your_turn") }}</span>
            </div>
          </div>
        </Transition>
      </div>

      <div v-else class="connecting">
        <div class="spinner" />
        <div>Connecting to game...</div>
      </div>
    </div>

    <!-- Sidebar -->
    <div class="sidebar">
      <div class="sidebar-panel">
        <div class="sidebar-title">Controls</div>
        <button class="back-btn" @click="goBack">← {{ $t("common.back") }}</button>
        <button class="new-game-btn" @click="createNewGame">🆕 New Game</button>
      </div>

      <!-- プレイヤーリスト -->
      <div v-if="gameState?.players" class="sidebar-panel">
        <div class="sidebar-title">Players</div>
        <div v-for="[role, id] in playerEntries" :key="role" class="player-row">
          <span class="player-role">{{ role }}</span>
          <span class="player-id">{{ id ?? "waiting..." }}</span>
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

      <!-- チャットパネル -->
      <div class="chat-container">
        <ChatPanel
          :messages="chatMessages"
          :is-player="isPlayer"
          :my-player-id="myPlayerId"
          :players="currentPlayersList"
          @send="onSendChat"
        />
      </div>
    </div>

    <!-- Notification Snackbar -->
    <v-snackbar v-model="showSnackbar" :color="snackbarColor" location="top" class="rounded-lg">
      {{ snackbarMsg }}
      <template #actions>
        <v-btn variant="text" @click="showSnackbar = false"> Close </v-btn>
      </template>
    </v-snackbar>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from "vue";
import { useRouter } from "vue-router";
import { SocketIoClient } from "../../network/SocketIoClient";
import ChatPanel from "@/components/ChatPanel.vue";
import { getGameCatalogEntry, getGameComponent } from "@/games/registry";
import { useGameSound } from "@/sound/useGameSound";
import { API_BASE_URL } from "@/config";
import type { BaseGameState, BaseGameAction } from "@engine/shared/GameRules";

// この画面はゲーム種別を問わず動くので、エンジン共通の型で扱う。
// 具体的な State / Action 型は各盤面コンポーネント側が持つ。
type GameState = BaseGameState;
type GameAction = BaseGameAction;

const props = defineProps<{
  gameType: string;
  gameEmoji: string;
  gameName: string;
  authToken: string;
  roomId: string;
  spectate?: boolean;
}>();

const emit = defineEmits<{ (e: "back"): void }>();

const roomId = ref(props.roomId);
const errorMsg = ref("");
const gameState = ref<GameState | null>(null);
// 直近の状態更新を生んだアクション（サーバーが同梱したときだけ。効果音の判定に使う）
const lastAction = ref<GameAction | null>(null);
// サーバー時計との差（締切カウントダウンと、リアルタイム系ゲームの予測に使う）
const clockSkew = ref(0);
// 締切カウントダウン（サーバー時計との差を補正）
const now = ref(Date.now());
let clockTimer: ReturnType<typeof setInterval> | null = null;
const remainingSeconds = computed(() => {
  const deadline = gameState.value?.turnDeadline;
  if (deadline === undefined || !client) return null;
  const serverNow = now.value - clockSkew.value;
  return Math.max(0, Math.ceil((deadline - serverNow) / 1000));
});
const connectionStatus = ref("Connecting");
const showSnackbar = ref(false);
const snackbarMsg = ref("");
const snackbarColor = ref("info");

const chatMessages = ref<
  {
    userId: string;
    message: string;
    channel: "public" | "private";
    timestamp: string;
  }[]
>([]);

// 盤面コンポーネントは src/games/<type>/index.ts の定義から引く
const gameComponent = computed(() => getGameComponent(props.gameType));

let client: SocketIoClient<GameState, GameAction>;

const statusClass = computed(() => ({
  connected: connectionStatus.value === "Connected",
  disconnected: connectionStatus.value !== "Connected",
}));

const prettyState = computed(() => JSON.stringify(gameState.value, null, 2));

const playerEntries = computed<[string, string | null][]>(() => {
  if (!gameState.value?.players) return [];
  return Object.entries(gameState.value.players) as [string, string | null][];
});

const gameMinPlayers = computed(() => getGameCatalogEntry(props.gameType)?.minPlayers ?? 0);

const currentPlayerCount = computed(() => {
  if (!gameState.value?.players) return 0;
  return Object.values(gameState.value.players).filter((p) => p !== null).length;
});

const myPlayerId = computed(() => {
  return localStorage.getItem("game_username") || "";
});

const isMyTurn = computed(() => {
  if (!gameState.value || gameState.value.status !== "PLAYING" || !isPlayer.value) return false;
  return gameState.value.activePlayers?.includes(myPlayerId.value);
});

const isPlayer = computed(() => {
  if (!gameState.value?.players) return false;
  return Object.values(gameState.value.players).includes(myPlayerId.value);
});

const currentPlayersList = computed(() => {
  if (!gameState.value?.players) return [];
  return Object.values(gameState.value.players).filter(Boolean) as string[];
});

// 効果音・BGM（ゲームごとの定義は src/games/<type>/sound.ts、共通音は src/sound/common.ts）
useGameSound({
  gameType: props.gameType,
  state: gameState,
  lastAction,
  // 着席していなければ観戦者扱い（手番音・勝敗音を鳴らさない）
  myPlayerId: () => (isPlayer.value ? myPlayerId.value : "SPECTATOR"),
  mode: "live",
});

onMounted(() => {
  client = new SocketIoClient<GameState, GameAction>(API_BASE_URL, props.authToken);
  client.onStateUpdate = (state, meta) => {
    clockSkew.value = client.clockSkew;
    // watch(gameState) で参照するので state より先に入れる
    lastAction.value = meta?.action ?? null;
    gameState.value = state;
    connectionStatus.value = "Connected";
    errorMsg.value = "";
  };
  client.onError = (msg) => {
    if (msg.includes("has left the game")) {
      snackbarMsg.value = msg;
      snackbarColor.value = "warning";
      showSnackbar.value = true;
    } else {
      errorMsg.value = msg;
    }
  };

  client.onChatMessage = (chat) => {
    chatMessages.value.push(chat);
  };

  client.connect(props.roomId, { asSpectator: !!props.spectate });
  clockTimer = setInterval(() => {
    now.value = Date.now();
  }, 250);
});

// Removed joinAsSpectator as it is now handled in RoomListView

onUnmounted(() => {
  if (clockTimer) clearInterval(clockTimer);
  client?.disconnect();
});

const router = useRouter();

async function createNewGame() {
  try {
    connectionStatus.value = "Creating...";
    const id = await client.createGame({
      type: props.gameType.toUpperCase().replace("-", "_"),
    });
    router.push(`/game/${props.gameType}/${id}`);
  } catch {
    errorMsg.value = "Failed to create game";
    connectionStatus.value = "Error";
  }
}

function goBack() {
  if (client && props.roomId) {
    client.leaveGame(props.roomId);
  }
  emit("back");
}

function onGameAction(action: GameAction) {
  client.sendAction(action);
}

function onSendChat({
  message,
  channel,
  recipientId,
}: {
  message: string;
  channel: "public" | "private";
  recipientId?: string;
}) {
  client.sendChat(message, channel, recipientId);
}
</script>

<style scoped>
@import url("https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&family=JetBrains+Mono&display=swap");

.generic-view {
  display: flex;
  width: 100%;
  height: 100%;
  background: rgb(var(--v-theme-background));
  font-family: "Inter", sans-serif;
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
  font-family: "JetBrains Mono", monospace;
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
.status-pill.connected {
  background: rgba(var(--v-theme-success), 0.15);
  color: rgb(var(--v-theme-success));
}
.status-pill.disconnected {
  background: rgba(var(--v-theme-warning), 0.15);
  color: rgb(var(--v-theme-warning));
}

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
  background: rgba(var(--v-theme-surface), 0.5);
  border: 1px solid rgba(var(--v-theme-on-surface), 0.1);
  border-radius: 16px;
  padding: 24px;
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
.status-badge.PLAYING {
  background: rgba(var(--v-theme-primary), 0.2);
  color: rgb(var(--v-theme-primary));
}
.status-badge.FINISHED {
  background: rgba(var(--v-theme-warning), 0.2);
  color: rgb(var(--v-theme-warning));
}

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
  font-family: "JetBrains Mono", monospace;
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
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

/* === Sidebar === */
.sidebar {
  width: 280px;
  min-width: 280px;
  border-left: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  overflow: hidden; /* Important: Sidebar itself shouldn't scroll if we want chat to be flex:1 */
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

.back-btn,
.new-game-btn {
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
.back-btn:hover {
  background: rgba(var(--v-theme-on-surface), 0.1);
  transform: translateY(-1px);
}
.new-game-btn {
  background: rgb(var(--v-theme-primary));
  color: rgb(var(--v-theme-on-primary));
  box-shadow: 0 4px 12px rgba(var(--v-theme-primary), 0.3);
}
.new-game-btn:hover {
  opacity: 0.9;
  transform: translateY(-1px);
  box-shadow: 0 6px 16px rgba(var(--v-theme-primary), 0.4);
}

.player-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 0.8rem;
  padding: 6px 0;
  border-bottom: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}
.player-row:last-child {
  border-bottom: none;
}
.player-role {
  color: rgb(var(--v-theme-on-surface));
  opacity: 0.8;
  font-weight: 600;
}
.player-id {
  font-family: "JetBrains Mono", monospace;
  color: rgb(var(--v-theme-on-surface));
  opacity: 0.6;
  font-size: 0.7rem;
}

/* === Waiting Overlay === */
.waiting-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(var(--v-theme-background), 0.95);
  backdrop-filter: blur(12px);
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 16px;
  border: 1px solid rgba(var(--v-theme-primary), 0.3);
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
  font-family: "JetBrains Mono", monospace;
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
  to {
    transform: rotate(360deg);
  }
}

.json-details summary {
  cursor: pointer;
  font-size: 0.75rem;
  color: rgb(var(--v-theme-on-surface));
  opacity: 0.6;
  user-select: none;
}
.json-view-mini {
  font-family: "JetBrains Mono", monospace;
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
.deadline-badge {
  position: absolute;
  top: 20px;
  right: 20px;
  z-index: 1000;
  padding: 6px 12px;
  border-radius: 999px;
  background: rgba(var(--v-theme-surface), 0.9);
  color: rgb(var(--v-theme-on-surface));
  font-variant-numeric: tabular-nums;
  font-weight: 600;
  pointer-events: none;
}
.deadline-badge.urgent {
  background: rgb(var(--v-theme-error));
  color: rgb(var(--v-theme-on-error));
}

.turn-notification {
  position: absolute;
  top: 20px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 1000;
  pointer-events: none;
}

.chat-container {
  flex: 1;
  min-height: 300px;
  margin-top: 10px;
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
  0% {
    transform: scale(1);
    opacity: 1;
  }
  50% {
    transform: scale(1.2);
    opacity: 0.8;
  }
  100% {
    transform: scale(1);
    opacity: 1;
  }
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
