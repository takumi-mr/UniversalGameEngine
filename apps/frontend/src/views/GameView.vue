<template>
  <div class="game-view-wrapper">
    <div class="user-bar">
      <button @click="back" class="back-btn">← Back to Rooms</button>
      <span>Logged in as: <strong>{{ username }}</strong></span>
      <button @click="logout" class="logout-btn">Logout</button>
    </div>
    <GenericGameView
      :game-type="gameType"
      :game-emoji="gameInfo?.emoji ?? '🎮'"
      :game-name="gameInfo?.name ?? gameType"
      :auth-token="authToken"
      :room-id="roomId"
      @back="back"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import GenericGameView from '../components/GenericGameView.vue';
import { availableGames } from '../constants/games';

const route = useRoute();
const router = useRouter();

const gameType = ref(route.params.gameType as string);
const roomId = ref(route.params.roomId as string);
const authToken = ref(localStorage.getItem('game_token') || '');
const username = ref(localStorage.getItem('game_username') || '');

const gameInfo = computed(() => availableGames.find(g => g.type === gameType.value));

const back = () => {
  router.push(`/rooms/${gameType.value}`);
};

const logout = () => {
  localStorage.removeItem('game_token');
  localStorage.removeItem('game_username');
  router.push('/login');
};
</script>

<style scoped>
.game-view-wrapper {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
}

.user-bar {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 15px;
  background: rgba(15, 23, 42, 0.95);
  backdrop-filter: blur(8px);
  border-bottom: 1px solid rgba(255,255,255,0.06);
  padding: 7px 20px;
  font-family: 'Inter', sans-serif;
  font-size: 0.82rem;
  color: #94a3b8;
  z-index: 1000;
}
.user-bar strong { color: #e2e8f0; }
.user-bar span { flex: 1; text-align: center; }

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
}
</style>
