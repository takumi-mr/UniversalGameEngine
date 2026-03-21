<template>
  <v-app>
    <!-- Top App Bar in Game -->
    <v-app-bar
      flat
      border="none"
      color="surface"
      density="compact"
    >
      <v-btn
        icon="mdi-chevron-left"
        variant="text"
        @click="back"
      />
      <v-app-bar-title class="text-subtitle-1 font-weight-bold">
        {{ gameInfo?.emoji }} {{ $t(`games.${gameType}.name`) }} — Room: {{ roomId }}
      </v-app-bar-title>
      <v-spacer />
      
      <!-- Theme Switcher -->
      <ThemeSwitcher class="mr-2" />
      
      <v-menu>
        <template #activator="{ props }">
          <v-btn
            v-bind="props"
            variant="text"
            prepend-icon="mdi-translate"
          >
            {{ $i18n.locale === 'ja' ? '日本語' : 'English' }}
          </v-btn>
        </template>
        <v-list>
          <v-list-item @click="setLocale('en')">
            <v-list-item-title>English</v-list-item-title>
          </v-list-item>
          <v-list-item @click="setLocale('ja')">
            <v-list-item-title>日本語</v-list-item-title>
          </v-list-item>
        </v-list>
      </v-menu>

      <v-btn
        icon="mdi-help-circle-outline"
        variant="text"
        class="mr-2"
        @click="showHelp = true"
      />

      <div class="px-4 text-caption text-medium-emphasis d-none d-sm-flex align-center">
        <v-icon
          icon="mdi-account-circle"
          class="mr-2"
        />
        <strong>{{ username }}</strong>
      </div>
      <v-btn
        icon="mdi-logout"
        color="error"
        variant="text"
        size="small"
        @click="logout"
      />
    </v-app-bar>

    <v-main class="fill-height">
      <!-- Main Game View -->
      <GenericGameView
        :game-type="gameType"
        :game-emoji="gameInfo?.emoji ?? '🎮'"
        :game-name="gameInfo?.name ?? gameType"
        :auth-token="authToken"
        :room-id="roomId"
        :spectate="spectate"
        @back="back"
      />
    </v-main>

    <!-- Help Dialog -->
    <GameHelpDialog
      v-model="showHelp"
      :game-name="$t(`games.${gameType}.name`)"
      :game-emoji="gameInfo?.emoji ?? '🎮'"
      :game-rules="$t(`games.${gameType}.rules`)"
      :game-description="$t(`games.${gameType}.description`)"
    >
      <template #custom>
        <GameHelpTabs :game-type="gameType" />
      </template>
    </GameHelpDialog>
  </v-app>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import GenericGameView from '../components/GenericGameView.vue';
import GameHelpDialog from '../components/game/GameHelpDialog.vue';
import GameHelpTabs from '../components/game/GameHelpTabs.vue';
import ThemeSwitcher from '../components/ThemeSwitcher.vue';
import { availableGames } from '../constants/games';

import { useAuthStore } from '../store/auth';
import { useGameStore } from '../store/game';
import { useUIStore } from '../store/ui';
import { useI18n } from 'vue-i18n';

const route = useRoute();
const router = useRouter();
const authStore = useAuthStore();
const gameStore = useGameStore();
const uiStore = useUIStore();

const gameType = ref(route.params.gameType as string);
const roomId = ref(route.params.roomId as string);
const spectate = ref(route.query.spectate === 'true');
const authToken = computed(() => authStore.token || '');
const username = computed(() => authStore.username || 'Unknown');

const showHelp = ref(false);

const gameInfo = computed(() => availableGames.find(g => g.type === gameType.value));

import { onMounted } from 'vue';
onMounted(() => {
  gameStore.setGame(gameType.value, roomId.value);
});

const back = () => {
  gameStore.clearGame();
  router.push('/selection');
};

const logout = () => {
  authStore.logout();
  gameStore.clearGame();
  router.push('/login');
};

const { locale } = useI18n();
const setLocale = (lang: string) => {
  uiStore.setLocale(lang);
  locale.value = lang;
};
</script>

<style scoped>
.fill-height {
  height: 100vh;
}
</style>
