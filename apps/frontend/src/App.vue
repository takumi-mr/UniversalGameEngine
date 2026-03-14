<template>
  <!-- ログインまだ -->
  <Login v-if="!isAuthenticated" @login-success="onLoginSuccess" />

  <!-- ゲーム選択 -->
  <div v-else-if="!selectedGameType" class="app-wrapper">
    <div class="user-bar">
      Logged in as: <strong>{{ username }}</strong>
      <button @click="logout" class="logout-btn">Logout</button>
    </div>
    <GameSelector :games="availableGames" @select="onGameSelected" />
  </div>

  <!-- Rubik's Cube: 専用3Dビュー -->
  <div v-else-if="selectedGameType === 'rubiks-cube'" class="app-wrapper">
    <div class="user-bar">
      Logged in as: <strong>{{ username }}</strong>
      <button @click="backToSelector" class="back-btn">← ゲーム選択</button>
      <button @click="logout" class="logout-btn">Logout</button>
    </div>
    <RubiksCube />
  </div>

  <!-- 3D Othello: 専用3Dビュー -->
  <div v-else-if="selectedGameType === 'othello-3d'" class="app-wrapper">
    <div class="user-bar">
      Logged in as: <strong>{{ username }}</strong>
      <button @click="backToSelector" class="back-btn">← ゲーム選択</button>
      <button @click="logout" class="logout-btn">Logout</button>
    </div>
    <Othello3D :authToken="authToken" />
  </div>

  <!-- Shogi: 専用3Dビュー -->
  <div v-else-if="selectedGameType === 'shogi'" class="app-wrapper">
    <div class="user-bar">
      Logged in as: <strong>{{ username }}</strong>
      <button @click="backToSelector" class="back-btn">← ゲーム選択</button>
      <button @click="logout" class="logout-btn">Logout</button>
    </div>
    <Shogi :authToken="authToken" />
  </div>

  <!-- その他のゲーム: 汎用ビュー -->
  <div v-else class="app-wrapper">
    <div class="user-bar">
      Logged in as: <strong>{{ username }}</strong>
      <button @click="backToSelector" class="back-btn">← ゲーム選択</button>
      <button @click="logout" class="logout-btn">Logout</button>
    </div>
    <GenericGameView
      :game-type="selectedGameType"
      :game-emoji="selectedGameInfo?.emoji ?? '🎮'"
      :game-name="selectedGameInfo?.name ?? selectedGameType"
      :auth-token="authToken"
      @back="backToSelector"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import Login from './components/Login.vue';
import GameSelector from './components/GameSelector.vue';
import RubiksCube from './components/RubiksCube.vue';
import Othello3D from './components/Othello3D.vue';
import GenericGameView from './components/GenericGameView.vue';

// ゲームの定義はフロントで静的に持つ（バックエンドと同期）
const availableGames = [
  { type: 'othello-3d',   name: '3D Othello',       description: '3D立体オセロ。26方向に挟める！',       emoji: '🟦', minPlayers: 2, maxPlayers: 2 },
  { type: 'othello',      name: 'Othello',            description: '古典的な2Dオセロ（リバーシ）。',         emoji: '⚫', minPlayers: 2, maxPlayers: 2 },
  { type: 'high-low',     name: 'High-Low Card',      description: '引いたカードの強さで競うカードゲーム。', emoji: '🃏', minPlayers: 1, maxPlayers: 2 },
  { type: 'texas-holdem', name: "Texas Hold'em",      description: 'テキサスホールデムポーカー。',             emoji: '🂡', minPlayers: 2, maxPlayers: 6 },
  { type: 'mahjong',      name: 'Mahjong',            description: '4人麻雀。役・符・点数計算対応。',         emoji: '🀄', minPlayers: 4, maxPlayers: 4 },
  { type: 'daifugo',      name: '大富豪',              description: '大富豪（ジョーカー入り54枚）。',           emoji: '👑', minPlayers: 2, maxPlayers: 4 },
  { type: 'rubiks-cube',  name: "Rubik's Cube",       description: '1人用ルービックキューブ。',               emoji: '🟥', minPlayers: 1, maxPlayers: 1 },
];

const isAuthenticated  = ref(false);
const authToken        = ref('');
const username         = ref('');
const selectedGameType = ref<string | null>(null);

const selectedGameInfo = computed(() =>
  availableGames.find(g => g.type === selectedGameType.value) ?? null
);

onMounted(() => {
  const token = localStorage.getItem('game_token');
  const user  = localStorage.getItem('game_username');
  if (token && user) {
    authToken.value = token;
    username.value = user;
    isAuthenticated.value = true;
  }
});

function onLoginSuccess(token: string, user: string) {
  authToken.value = token;
  username.value = user;
  isAuthenticated.value = true;
}

function onGameSelected(type: string) {
  selectedGameType.value = type;
}

function backToSelector() {
  selectedGameType.value = null;
}

function logout() {
  localStorage.removeItem('game_token');
  localStorage.removeItem('game_username');
  isAuthenticated.value = false;
  authToken.value = '';
  username.value = '';
  selectedGameType.value = null;
  window.location.reload();
}
</script>

<style>
/* Global */
*, *::before, *::after { box-sizing: border-box; }
html, body { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; background: #0f172a; }
#app { width: 100%; height: 100%; }
</style>

<style scoped>
.app-wrapper {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  position: relative;
}

/* Children fill remaining height */
.app-wrapper > *:not(.user-bar) {
  flex: 1;
  min-height: 0;
}

/* === Top Bar === */
.user-bar {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 10px;
  background: rgba(15, 23, 42, 0.95);
  backdrop-filter: blur(8px);
  border-bottom: 1px solid rgba(255,255,255,0.06);
  padding: 7px 20px;
  font-family: 'Inter', sans-serif;
  font-size: 0.82rem;
  color: #94a3b8;
  position: relative;
  z-index: 1000;
}
.user-bar strong { color: #e2e8f0; }

.back-btn {
  background: rgba(255,255,255,0.07);
  color: #94a3b8;
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 8px;
  padding: 4px 12px;
  font-size: 0.78rem;
  cursor: pointer;
  transition: all 0.15s ease;
}
.back-btn:hover { background: rgba(255,255,255,0.14); color: #e2e8f0; }

.logout-btn {
  background: rgba(239, 68, 68, 0.15);
  color: #f87171;
  border: 1px solid rgba(239, 68, 68, 0.25);
  border-radius: 8px;
  padding: 4px 12px;
  font-size: 0.78rem;
  cursor: pointer;
  transition: all 0.15s ease;
}
.logout-btn:hover { background: rgba(239, 68, 68, 0.3); }
</style>
