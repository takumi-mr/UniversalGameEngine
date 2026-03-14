<template>
  <div class="room-list-container">
    <div class="user-bar">
      <button @click="back" class="back-btn">← Back to Selection</button>
      <span>Logged in as: <strong>{{ username }}</strong></span>
    </div>

    <div class="content-wrapper">
      <div class="game-header">
        <span class="game-emoji">{{ gameEmoji }}</span>
        <h1>{{ gameName }} Rooms</h1>
        <p>{{ gameDescription }}</p>
      </div>

      <div class="actions">
        <button @click="createNewRoom" class="create-btn" :disabled="creating">
          {{ creating ? 'Creating...' : '🆕 Create New Room' }}
        </button>
        <button @click="fetchRooms" class="refresh-btn">🔄 Refresh List</button>
      </div>

      <div v-if="loading" class="loading">Loading rooms...</div>
      <div v-else-if="rooms.length === 0" class="no-rooms">
        <p>No active rooms for this game. Create one!</p>
      </div>
      <div v-else class="rooms-grid">
        <div v-for="room in rooms" :key="room.id" class="room-card">
          <div class="room-info">
            <span class="room-id">ID: {{ room.id }}</span>
            <span class="player-count">👥 {{ room.playerCount }} Players</span>
          </div>
          <button @click="joinRoom(room.id)" class="join-btn">Join</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { availableGames } from '../constants/games';
import { SocketIoClient } from '../network/SocketIoClient';

const route = useRoute();
const router = useRouter();
const gameType = ref(route.params.gameType as string);

const username = ref(localStorage.getItem('game_username') || 'Unknown');
const rooms = ref<any[]>([]);
const loading = ref(true);
const creating = ref(false);

const gameInfo = computed(() => availableGames.find(g => g.type === gameType.value));
const gameName = computed(() => gameInfo.value?.name || gameType.value);
const gameEmoji = computed(() => gameInfo.value?.emoji || '🎮');
const gameDescription = computed(() => gameInfo.value?.description || '');

const API_BASE = 'http://127.0.0.1:3000';

const fetchRooms = async () => {
  loading.value = true;
  try {
    const res = await fetch(`${API_BASE}/rooms/${gameType.value}`);
    const data = await res.json();
    rooms.value = data.rooms;
  } catch (err) {
    console.error('Failed to fetch rooms:', err);
  } finally {
    loading.value = false;
  }
};

onMounted(fetchRooms);

const createNewRoom = async () => {
  creating.value = true;
  try {
    const token = localStorage.getItem('game_token') || '';
    const client = new SocketIoClient(API_BASE, token);
    const id = await client.createGame({ type: gameType.value.toUpperCase().replace('-', '_') });
    router.push(`/game/${gameType.value}/${id}`);
  } catch (err) {
    console.error('Failed to create room:', err);
    alert('Failed to create room');
  } finally {
    creating.value = false;
  }
};

const joinRoom = (roomId: string) => {
  router.push(`/game/${gameType.value}/${roomId}`);
};

const back = () => {
  router.push('/selection');
};
</script>

<style scoped>
.room-list-container {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: #0f172a;
  color: #e2e8f0;
}

.user-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 7px 20px;
  background: rgba(15, 23, 42, 0.95);
  border-bottom: 1px solid rgba(255,255,255,0.06);
  font-size: 0.82rem;
  color: #94a3b8;
}
.user-bar strong { color: #e2e8f0; }

.back-btn {
  background: rgba(255,255,255,0.07);
  color: #94a3b8;
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 8px;
  padding: 4px 12px;
  cursor: pointer;
}

.content-wrapper {
  flex: 1;
  padding: 40px;
  max-width: 800px;
  margin: 0 auto;
  width: 100%;
  overflow-y: auto;
}

.game-header {
  text-align: center;
  margin-bottom: 40px;
}
.game-emoji {
  font-size: 4rem;
}
.game-header h1 {
  font-size: 2.5rem;
  margin: 10px 0;
  background: linear-gradient(135deg, #fff 0%, #94a3b8 100%);
  background-clip: text;
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}
.game-header p {
  color: #64748b;
}

.actions {
  display: flex;
  gap: 15px;
  margin-bottom: 30px;
  justify-content: center;
}

.create-btn {
  background: linear-gradient(135deg, #6366f1, #8b5cf6);
  color: white;
  border: none;
  padding: 12px 24px;
  border-radius: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: transform 0.2s;
}
.create-btn:hover { transform: translateY(-2px); }

.refresh-btn {
  background: rgba(255,255,255,0.05);
  color: #94a3b8;
  border: 1px solid rgba(255,255,255,0.1);
  padding: 12px 24px;
  border-radius: 12px;
  cursor: pointer;
}

.rooms-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
  gap: 20px;
}

.room-card {
  background: rgba(30, 41, 59, 0.7);
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 16px;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 15px;
}

.room-info {
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.room-id {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.9rem;
  color: #94a3b8;
}
.player-count {
  font-size: 0.8rem;
  color: #64748b;
}

.join-btn {
  background: rgba(99, 102, 241, 0.2);
  color: #818cf8;
  border: 1px solid rgba(99, 102, 241, 0.4);
  padding: 8px;
  border-radius: 8px;
  cursor: pointer;
  font-weight: 600;
  transition: all 0.2s;
}
.join-btn:hover {
  background: rgba(99, 102, 241, 0.4);
  color: white;
}

.loading, .no-rooms {
  text-align: center;
  padding: 40px;
  color: #64748b;
}
</style>
