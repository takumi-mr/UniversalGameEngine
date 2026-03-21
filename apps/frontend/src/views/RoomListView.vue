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
      ></v-btn>

      <div class="px-4 text-body-2 text-medium-emphasis">
        {{ $t('common.logged_in_as', { username: authStore.username }) }}
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
                <v-menu>
                  <template v-slot:activator="{ props }">
                    <v-btn
                      v-bind="props"
                      color="primary"
                      size="large"
                      prepend-icon="mdi-plus"
                      append-icon="mdi-menu-down"
                      class="rounded-lg font-weight-bold"
                      :loading="creating"
                    >
                      {{ $t('common.create_new_room') }}
                    </v-btn>
                  </template>
                  <v-list>
                    <v-list-item @click="createNewRoom()">
                      <template v-slot:prepend>
                        <v-icon icon="mdi-account-multiple" class="mr-2"></v-icon>
                      </template>
                      <v-list-item-title>Play with Human</v-list-item-title>
                    </v-list-item>
                    <v-list-item @click="createNewRoom('random')">
                      <template v-slot:prepend>
                        <v-icon icon="mdi-robot-outline" class="mr-2"></v-icon>
                      </template>
                      <v-list-item-title>Quick AI Match (Random)</v-list-item-title>
                    </v-list-item>
                    <v-divider class="my-1"></v-divider>
                    <v-list-item @click="openCustomSetup()">
                      <template v-slot:prepend>
                        <v-icon icon="mdi-cog" class="mr-2"></v-icon>
                      </template>
                      <v-list-item-title>Custom Match Setup...</v-list-item-title>
                    </v-list-item>
                  </v-list>
                </v-menu>
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

    <!-- Custom Match Setup Dialog -->
    <v-dialog v-model="showCustomSetup" max-width="560" persistent>
      <v-card class="rounded-xl pa-4">
        <v-card-title class="text-h5 font-weight-bold text-center">
          ⚙️ Custom Match Setup
        </v-card-title>
        <v-card-subtitle class="text-center text-medium-emphasis">
          {{ translatedGameName }} — Choose a type for each player slot
        </v-card-subtitle>

        <v-card-text class="mt-4">
          <div class="d-flex align-center justify-space-between mb-4">
            <span class="text-body-1 font-weight-medium">Players ({{ customSlots.length }})</span>
            <div>
              <v-btn
                icon="mdi-minus"
                variant="tonal"
                size="small"
                :disabled="customSlots.length <= customMinPlayers"
                @click="removeSlot"
                class="mr-1"
              ></v-btn>
              <v-btn
                icon="mdi-plus"
                variant="tonal"
                size="small"
                :disabled="customSlots.length >= customMaxPlayers"
                @click="addSlot"
              ></v-btn>
            </div>
          </div>

          <v-row v-for="(slot, idx) in customSlots" :key="idx" class="mb-2" align="center">
            <v-col cols="4" class="py-1">
              <span class="text-body-2 font-weight-medium">
                {{ slotTypeIcon(slot) }} Player {{ idx + 1 }}
              </span>
            </v-col>
            <v-col cols="8" class="py-1">
              <v-select
                v-model="customSlots[idx]"
                :items="playerTypeOptions"
                item-title="label"
                item-value="value"
                density="compact"
                variant="outlined"
                hide-details
                class="rounded-lg"
              ></v-select>
            </v-col>
          </v-row>
        </v-card-text>

        <v-card-actions class="flex-column gap-2 mt-2">
          <v-btn
            block
            color="primary"
            variant="flat"
            size="large"
            class="rounded-lg font-weight-bold"
            prepend-icon="mdi-play"
            :loading="creating"
            @click="startCustomMatch"
          >
            Start Match
          </v-btn>
          <v-btn
            block
            variant="text"
            class="mt-1"
            @click="showCustomSetup = false"
          >
            Cancel
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
import { SocketIoClient } from '../../network/SocketIoClient';
import GameHelpDialog from '../components/game/GameHelpDialog.vue';
import ThemeSwitcher from '../components/ThemeSwitcher.vue';
import { generatePuzzle } from '../utils/sudokuGenerator';
import { useAuthStore } from '../store/auth';
import { useRoomStore } from '../store/room';
import { useUIStore } from '../store/ui';

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
const authStore = useAuthStore();
const roomStore = useRoomStore();
const uiStore = useUIStore();

const gameType = ref(route.params.gameType as string);

const rooms = computed(() => roomStore.rooms);
const loading = computed(() => roomStore.loading);
const creating = ref(false);
const showHelp = ref(false);
const showJoinDialog = ref(false);
const selectedRoomId = ref<string | null>(null);

// カスタムマッチ用の状態
const showCustomSetup = ref(false);
const customSlots = ref<string[]>([]);
const playerTypeOptions = [
  { label: '👤 Human', value: 'human' },
  { label: '🎲 Random AI', value: 'random' },
  { label: '🤖 Minimax AI', value: 'minimax' },
  { label: '🧠 MCTS AI', value: 'mcts' },
  { label: '☁️ gRPC External', value: 'grpc_bot' },
];

const gameInfo = computed(() => availableGames.find(g => g.type === gameType.value));
const gameEmoji = computed(() => gameInfo.value?.emoji || '🎮');
const customMinPlayers = computed(() => gameInfo.value?.minPlayers ?? 2);
const customMaxPlayers = computed(() => gameInfo.value?.maxPlayers ?? 2);

const slotTypeIcon = (slotType: string) => {
  const map: Record<string, string> = { human: '👤', random: '🎲', minimax: '🤖', mcts: '🧠', grpc_bot: '☁️' };
  return map[slotType] || '❓';
};

const openCustomSetup = () => {
  // ゲームの最小プレイヤー数でスロットを初期化 (デフォルトは全て human)
  const min = customMinPlayers.value;
  customSlots.value = Array.from({ length: min }, () => 'human');
  showCustomSetup.value = true;
};

const addSlot = () => {
  if (customSlots.value.length < customMaxPlayers.value) {
    customSlots.value.push('human');
  }
};

const removeSlot = () => {
  if (customSlots.value.length > customMinPlayers.value) {
    customSlots.value.pop();
  }
};

import { useI18n } from 'vue-i18n';
const { t } = useI18n();
const translatedGameName = computed(() => t(`games.${gameType.value}.name`));
const translatedGameDescription = computed(() => t(`games.${gameType.value}.description`));
const translatedGameRules = computed(() => t(`games.${gameType.value}.rules`));

const fetchRooms = () => roomStore.fetchRooms(gameType.value);

onMounted(fetchRooms);

// ゲームルーム作成（レガシー互換: addAi で全スロットを同じAIで埋める）
const createNewRoom = async (aiType?: string) => {
  creating.value = true;
  try {
    const hookFn = gameHooks[gameType.value];
    let gameOptions: any = hookFn ? await hookFn() : {};
    
    if (aiType) {
      if (!gameOptions) gameOptions = {};
      gameOptions.addAi = aiType;
    }

    const token = authStore.token || '';
    const API_BASE = 'http://127.0.0.1:3000';
    const client = new SocketIoClient(API_BASE, token);
    const id = await client.createGame({
      type: gameType.value.toUpperCase().replace(/-/g, '_'),
      gameOptions,
    });
    client.disconnect();
    router.push(`/game/${gameType.value}/${id}`);
  } catch (err) {
    console.error('Failed to create room:', err);
  } finally {
    creating.value = false;
  }
};

// カスタムマッチ: playersConfig を渡してゲーム作成
const startCustomMatch = async () => {
  creating.value = true;
  try {
    const hookFn = gameHooks[gameType.value];
    let gameOptions: any = hookFn ? await hookFn() : {};
    if (!gameOptions) gameOptions = {};
    gameOptions.playersConfig = customSlots.value;

    const token = authStore.token || '';
    const API_BASE = 'http://127.0.0.1:3000';
    const client = new SocketIoClient(API_BASE, token);
    const id = await client.createGame({
      type: gameType.value.toUpperCase().replace(/-/g, '_'),
      gameOptions,
    });
    client.disconnect();
    showCustomSetup.value = false;
    
    // 全員AIなら観戦モードとして遷移
    const hasHuman = customSlots.value.includes('human');
    router.push({
      path: `/game/${gameType.value}/${id}`,
      query: hasHuman ? {} : { spectate: 'true' }
    });
  } catch (err) {
    console.error('Failed to create custom match:', err);
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

const { locale } = useI18n();
const setLocale = (lang: string) => {
  uiStore.setLocale(lang);
  locale.value = lang;
};
</script>

<style scoped>
.gap-2 {
  gap: 8px;
}
</style>
