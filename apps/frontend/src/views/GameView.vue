<template>
  <v-app>
    <!-- Top App Bar in Game -->
    <v-app-bar flat border="none" color="surface" density="compact">
      <v-btn icon="mdi-chevron-left" variant="text" @click="back"></v-btn>
      <v-app-bar-title class="text-subtitle-1 font-weight-bold">
        {{ gameInfo?.emoji }} {{ gameInfo?.name }} — Room: {{ roomId }}
      </v-app-bar-title>
      <v-spacer></v-spacer>
      
      <v-btn
        icon="mdi-help-circle-outline"
        variant="text"
        class="mr-2"
        @click="showHelp = true"
      ></v-btn>

      <div class="px-4 text-caption text-medium-emphasis d-none d-sm-flex align-center">
        <v-icon icon="mdi-account-circle" class="mr-2"></v-icon>
        <strong>{{ username }}</strong>
      </div>
      <v-btn icon="mdi-logout" color="error" variant="text" size="small" @click="logout"></v-btn>
    </v-app-bar>

    <v-main class="bg-grey-darken-4 fill-height">
      <!-- Main Game View -->
      <GenericGameView
        :game-type="gameType"
        :game-emoji="gameInfo?.emoji ?? '🎮'"
        :game-name="gameInfo?.name ?? gameType"
        :auth-token="authToken"
        :room-id="roomId"
        @back="back"
      />
    </v-main>

    <!-- Help Dialog -->
    <GameHelpDialog
      v-model="showHelp"
      :game-name="gameInfo?.name ?? gameType"
      :game-emoji="gameInfo?.emoji ?? '🎮'"
      :game-rules="(gameInfo as any)?.rules"
      :game-description="gameInfo?.description"
    />
  </v-app>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import GenericGameView from '../components/GenericGameView.vue';
import GameHelpDialog from '../components/game/GameHelpDialog.vue';
import { availableGames } from '../constants/games';

const route = useRoute();
const router = useRouter();

const gameType = ref(route.params.gameType as string);
const roomId = ref(route.params.roomId as string);
const authToken = ref(localStorage.getItem('game_token') || '');
const username = ref(localStorage.getItem('game_username') || '');

const showHelp = ref(false);

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
.fill-height {
  height: 100vh;
}
</style>
