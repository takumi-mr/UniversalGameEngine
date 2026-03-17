<template>
  <v-app>
    <!-- Top App Bar -->
    <v-app-bar flat border="none" color="surface">
      <v-btn icon="mdi-arrow-left" variant="text" @click="back"></v-btn>
      <v-app-bar-title class="font-weight-bold">
        {{ gameEmoji }} {{ translatedGameName }} {{ $t('common.rooms') }}
      </v-app-bar-title>
      <v-spacer></v-spacer>
      
      <!-- Theme Switcher -->
      <ThemeSwitcher class="mr-2" />

      <!-- Language Switcher -->
      <v-menu>
        <template v-slot:activator="{ props }">
          <v-btn
            v-bind="props"
            variant="text"
            prepend-icon="mdi-translate"
          >
            {{ $i18n.locale === 'ja' ? '日本語' : 'English' }}
          </v-btn>
        </template>
        <v-list>
          <v-list-item @click="$i18n.locale = 'en'">
            <v-list-item-title>English</v-list-item-title>
          </v-list-item>
          <v-list-item @click="$i18n.locale = 'ja'">
            <v-list-item-title>日本語</v-list-item-title>
          </v-list-item>
        </v-list>
      </v-menu>

      <v-btn
        icon="mdi-help-circle-outline"
        variant="text"
        class="mr-2"
        @click="showHelp = true"
      ></v-btn>

      <div class="px-4 text-body-2 text-medium-emphasis">
        {{ $t('common.logged_in_as', { username: username }) }}
      </div>
    </v-app-bar>

    <v-main>
      <v-container class="pa-6" fluid>
        <v-row justify="center">
          <v-col cols="12" md="10" lg="8">
            <div class="d-flex align-center mb-8">
              <div>
                <h1 class="text-h3 font-weight-bold mb-2">{{ translatedGameName }}</h1>
                <p class="text-body-1 text-medium-emphasis">{{ translatedGameDescription }}</p>
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
                  {{ $t('common.create_new_room') }}
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
              <div class="mt-4 text-body-1 text-medium-emphasis">{{ $t('common.finding_rooms') }}</div>
            </div>

            <v-row v-else-if="rooms.length > 0">
              <v-col v-for="room in rooms" :key="room.id" cols="12" sm="6" md="4">
                <v-card class="rounded-xl pa-4 bg-surface" border="none">
                  <v-card-item>
                    <template v-slot:prepend>
                      <v-icon icon="mdi-door-open" color="primary" size="32"></v-icon>
                    </template>
                    <v-card-title class="text-h6 font-weight-bold mb-1">{{ $t('common.room_no', { id: room.id.slice(0, 4) }) }}</v-card-title>
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
                        {{ $t('common.players_joined', { count: room.playerCount }) }}
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
                      {{ $t('common.join_match') }}
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
              <h2 class="text-h5 font-weight-bold mb-2">{{ $t('common.no_active_rooms') }}</h2>
              <p class="text-body-1 text-medium-emphasis mb-6">{{ $t('common.be_the_first') }}</p>
              <v-btn color="primary" variant="flat" @click="createNewRoom">{{ $t('common.create_first_room') }}</v-btn>
            </v-sheet>
          </v-col>
        </v-row>
      </v-container>
    </v-main>

    <!-- Help Dialog -->
    <GameHelpDialog
      v-model="showHelp"
      :game-name="translatedGameName"
      :game-emoji="gameEmoji"
      :game-rules="translatedGameRules"
      :game-description="translatedGameDescription"
    />

    <!-- Join Mode Dialog -->
    <v-dialog v-model="showJoinDialog" max-width="400">
      <v-card class="rounded-xl pa-4">
        <v-card-title class="text-h5 font-weight-bold text-center">
          {{ $t('common.join_room') }}
        </v-card-title>
        <v-card-text class="text-center text-medium-emphasis">
          {{ $t('common.choose_join_mode') }}
        </v-card-text>
        <v-card-actions class="flex-column gap-2 mt-4">
          <v-btn
            block
            color="primary"
            variant="flat"
            size="large"
            class="rounded-lg font-weight-bold"
            prepend-icon="mdi-controller"
            @click="confirmJoin(false)"
          >
            {{ $t('common.join_as_player') }}
          </v-btn>
          <v-btn
            block
            color="secondary"
            variant="tonal"
            size="large"
            class="rounded-lg font-weight-bold"
            prepend-icon="mdi-eye"
            @click="confirmJoin(true)"
          >
            {{ $t('common.join_as_spectator') }}
          </v-btn>
          <v-btn
            block
            variant="text"
            class="mt-2"
            @click="showJoinDialog = false"
          >
            {{ $t('common.cancel') }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-app>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { availableGames } from '../constants/games';
import { SocketIoClient } from '../network/SocketIoClient';
import GameHelpDialog from '../components/game/GameHelpDialog.vue';
import ThemeSwitcher from '../components/ThemeSwitcher.vue';
import { generatePuzzle } from '../utils/sudokuGenerator';

// ゲーム起動前に呼ばれる汎用フック
// 各ゲームの初期化処理を追加できる。戻り値は createGame の gameOptions に渡される
type GameHookFn = () => Promise<Record<string, unknown> | undefined>;
const gameHooks: Record<string, GameHookFn> = {
  sudoku: async () => {
    const initialBoard = generatePuzzle('medium');
    console.log('[gameHook:sudoku] puzzle generated', initialBoard);
    return { initialBoard };
  },
};

const route = useRoute();
const router = useRouter();
const gameType = ref(route.params.gameType as string);

const username = ref(localStorage.getItem('game_username') || 'Unknown');
const rooms = ref<any[]>([]);
const loading = ref(true);
const creating = ref(false);
const showHelp = ref(false);
const showJoinDialog = ref(false);
const selectedRoomId = ref<string | null>(null);

const gameInfo = computed(() => availableGames.find(g => g.type === gameType.value));
const gameEmoji = computed(() => gameInfo.value?.emoji || '🎮');

import { useI18n } from 'vue-i18n';
const { t } = useI18n();
const translatedGameName = computed(() => t(`games.${gameType.value}.name`));
const translatedGameDescription = computed(() => t(`games.${gameType.value}.description`));
const translatedGameRules = computed(() => t(`games.${gameType.value}.rules`));

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
    // ゲーム固有の起動前フックを実行（数独の場合は問題生成など）
    const hookFn = gameHooks[gameType.value];
    const gameOptions = hookFn ? await hookFn() : undefined;

    const token = localStorage.getItem('game_token') || '';
    const client = new SocketIoClient(API_BASE, token);
    const id = await client.createGame({
      type: gameType.value.toUpperCase().replace(/-/g, '_'),
      gameOptions,
    });
    router.push(`/game/${gameType.value}/${id}`);
  } catch (err) {
    console.error('Failed to create room:', err);
  } finally {
    creating.value = false;
  }
};

const joinRoom = (roomId: string) => {
  selectedRoomId.value = roomId;
  showJoinDialog.value = true;
};

const confirmJoin = (asSpectator: boolean) => {
  if (!selectedRoomId.value) return;
  router.push({
    path: `/game/${gameType.value}/${selectedRoomId.value}`,
    query: asSpectator ? { spectate: 'true' } : {}
  });
  showJoinDialog.value = false;
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
