<template>
  <div class="selection-view">
    <div class="user-bar">
      Logged in as: <strong>{{ username }}</strong>
      <button @click="logout" class="logout-btn">Logout</button>
    </div>
    <GameSelector :games="availableGames" @select="onGameSelected" />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import GameSelector from '../components/GameSelector.vue';
import { availableGames } from '../constants/games';

const router = useRouter();
const username = ref('');

onMounted(() => {
  username.value = localStorage.getItem('game_username') || 'Unknown';
});

const onGameSelected = (type: string) => {
  router.push(`/rooms/${type}`);
};

const logout = () => {
  localStorage.removeItem('game_token');
  localStorage.removeItem('game_username');
  router.push('/login');
};
</script>

<style scoped>
.selection-view {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
}

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
}
.user-bar strong { color: #e2e8f0; }

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
