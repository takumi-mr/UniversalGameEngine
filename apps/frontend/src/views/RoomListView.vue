<template>
  <v-app>
    <!-- Top App Bar -->
    <v-app-bar flat border="none" color="surface">
      <v-btn icon="mdi-arrow-left" variant="text" @click="back"></v-btn>
      <v-app-bar-title class="font-weight-bold">
        {{ gameEmoji }} {{ gameName }} Rooms
      </v-app-bar-title>
      <v-spacer></v-spacer>
      <div class="px-4 text-body-2 text-medium-emphasis">
        Logged in as: <strong class="text-high-emphasis">{{ username }}</strong>
      </div>
    </v-app-bar>

    <v-main class="bg-grey-darken-4">
      <v-container class="pa-6" fluid>
        <v-row justify="center">
          <v-col cols="12" md="10" lg="8">
            <div class="d-flex align-center mb-8">
              <div>
                <h1 class="text-h3 font-weight-bold mb-2">{{ gameName }}</h1>
                <p class="text-body-1 text-medium-emphasis">{{ gameDescription }}</p>
              </div>
              <v-spacer></v-spacer>
              <div class="d-flex gap-2">
                <v-btn
                  color="primary"
                  size="large"
                  prepend-icon="mdi-plus"
                  class="rounded-lg font-weight-bold"
                  :loading="creating"
                  @click="createNewRoom"
                >
                  Create New Room
                </v-btn>
                <v-btn
                  variant="outlined"
                  size="large"
                  icon="mdi-refresh"
                  class="rounded-lg ml-2"
                  @click="fetchRooms"
                ></v-btn>
              </div>
            </div>

            <v-divider class="mb-8"></v-divider>

            <div v-if="loading" class="text-center pa-12">
              <v-progress-circular indeterminate color="primary" size="64"></v-progress-circular>
              <div class="mt-4 text-body-1 text-medium-emphasis">Finding active rooms...</div>
            </div>

            <v-row v-else-if="rooms.length > 0">
              <v-col v-for="room in rooms" :key="room.id" cols="12" sm="6" md="4">
                <v-card class="rounded-xl pa-4 bg-surface" border="none">
                  <v-card-item>
                    <template v-slot:prepend>
                      <v-icon icon="mdi-door-open" color="primary" size="32"></v-icon>
                    </template>
                    <v-card-title class="text-h6 font-weight-bold mb-1">Room #{{ room.id.slice(0, 4) }}</v-card-title>
                    <v-card-subtitle>ID: {{ room.id }}</v-card-subtitle>
                  </v-card-item>

                  <v-card-text class="py-4">
                    <div class="d-flex align-center">
                      <v-chip
                        prepend-icon="mdi-account-group"
                        color="secondary"
                        variant="tonal"
                        size="small"
                        class="rounded-lg"
                      >
                        {{ room.playerCount }} Players Joined
                      </v-chip>
                    </div>
                  </v-card-text>

                  <v-card-actions>
                    <v-btn
                      block
                      color="primary"
                      variant="tonal"
                      class="rounded-lg font-weight-bold"
                      @click="joinRoom(room.id)"
                    >
                      Join Match
                    </v-btn>
                  </v-card-actions>
                </v-card>
              </v-col>
            </v-row>

            <v-sheet
              v-else
              class="text-center pa-12 rounded-xl bg-surface-variant"
              border="none"
              color="transparent"
            >
              <v-icon icon="mdi-ghost-off" size="64" color="medium-emphasis" class="mb-4"></v-icon>
              <h2 class="text-h5 font-weight-bold mb-2">No Active Rooms</h2>
              <p class="text-body-1 text-medium-emphasis mb-6">Be the first to start a new match in this category!</p>
              <v-btn color="primary" variant="flat" @click="createNewRoom">Create First Room</v-btn>
            </v-sheet>
          </v-col>
        </v-row>
      </v-container>
    </v-main>
  </v-app>
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
.gap-2 {
  gap: 8px;
}
</style>
