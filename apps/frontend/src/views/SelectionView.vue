<template>
  <v-app>
    <!-- Sidebar for Game Categories -->
    <v-navigation-drawer v-model="drawer" permanent border="none">
      <v-list density="compact" nav>
        <v-list-item
          prepend-icon="mdi-view-dashboard"
          :title="$t('categories.All')"
          :active="selectedCategory === 'All'"
          @click="selectedCategory = 'All'"
        />

        <v-divider class="my-2" />

        <v-list-item
          v-for="cat in categories"
          :key="cat"
          :title="$t('categories.' + cat)"
          prepend-icon="mdi-folder-outline"
          :active="selectedCategory === cat"
          @click="selectedCategory = cat"
        />
      </v-list>

      <template #append>
        <div class="pa-4">
          <v-btn block color="error" variant="tonal" prepend-icon="mdi-logout" @click="logout">
            {{ $t("common.logout") }}
          </v-btn>
        </div>
      </template>
    </v-navigation-drawer>

    <!-- Top App Bar -->
    <v-app-bar flat border="none" color="surface">
      <v-app-bar-title class="text-h5 font-weight-bold">
        <span class="text-primary">Universal</span>
        {{ $t("common.title").split(" ").slice(1).join(" ") || "Game Engine" }}
      </v-app-bar-title>
      <v-spacer />

      <!-- Theme Switcher -->
      <ThemeSwitcher class="mr-2" />

      <!-- Language Switcher -->
      <v-menu>
        <template #activator="{ props }">
          <v-btn v-bind="props" variant="text" prepend-icon="mdi-translate">
            {{ $i18n.locale === "ja" ? "日本語" : "English" }}
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

      <div class="px-4 text-body-2 text-medium-emphasis">
        {{ $t("common.logged_in_as", { username: authStore.username }) }}
      </div>
    </v-app-bar>

    <!-- Main Content -->
    <v-main style="height: 100vh; overflow-y: auto">
      <v-container class="pa-6" fluid>
        <!-- Active Games Section -->
        <div v-if="joinedRooms.length > 0" class="mb-10">
          <div class="d-flex align-center mb-4">
            <v-icon icon="mdi-controller-classic" color="primary" class="mr-2" />
            <h2 class="text-h5 font-weight-bold">
              {{ $t("common.active_games") }}
            </h2>
            <v-btn
              icon="mdi-refresh"
              variant="text"
              size="small"
              class="ml-2"
              @click="fetchJoinedRooms"
            />
          </div>
          <v-row>
            <v-col v-for="room in joinedRooms" :key="room.id" cols="12" sm="6" md="4" lg="3">
              <v-card class="active-game-card rounded-xl pa-4" variant="outlined">
                <div class="d-flex align-center mb-3">
                  <div class="text-h4 mr-3">
                    {{ getGameEmoji(room.type) }}
                  </div>
                  <div>
                    <div class="text-subtitle-1 font-weight-bold">
                      {{ $t("games." + room.type.toLowerCase() + ".name") }}
                    </div>
                    <div class="text-caption text-medium-emphasis">
                      ID: {{ room.id.slice(0, 8) }}
                    </div>
                  </div>
                </div>
                <div class="d-flex gap-2">
                  <v-btn
                    color="primary"
                    variant="flat"
                    size="small"
                    class="rounded-lg flex-grow-1"
                    @click="onGameSelected(room.type.toLowerCase(), room.id)"
                  >
                    {{ $t("common.join_match") }}
                  </v-btn>
                  <v-btn
                    color="error"
                    variant="tonal"
                    size="small"
                    icon="mdi-exit-run"
                    class="rounded-lg"
                    :loading="leavingId === room.id"
                    @click="leaveRoom(room.id)"
                  />
                </div>
              </v-card>
            </v-col>
          </v-row>
          <v-divider class="mt-8" />
        </div>

        <div class="mb-6">
          <h2 class="text-h4 font-weight-bold mb-2">
            {{ $t("categories." + selectedCategory) }}
          </h2>
          <p class="text-body-1 text-medium-emphasis">
            {{ $t("common.select_game_desc") }}
          </p>
        </div>

        <v-row>
          <v-col v-for="game in filteredGames" :key="game.type" cols="12" sm="6" md="4" lg="3">
            <v-hover v-slot="{ isHovering, props }">
              <v-card
                v-bind="props"
                :elevation="isHovering ? 12 : 2"
                :class="{ 'on-hover': isHovering }"
                class="rounded-xl overflow-hidden game-card"
                @click="onGameSelected(game.type)"
              >
                <div class="pa-6 d-flex flex-column align-center text-center fill-height">
                  <div class="text-h1 mb-4">
                    {{ game.emoji }}
                  </div>
                  <v-card-title class="text-h5 font-weight-bold pa-0 mb-2">
                    {{ $t("games." + game.type + ".name") }}
                  </v-card-title>
                  <v-card-text class="text-body-2 text-medium-emphasis pa-0">
                    {{ $t("games." + game.type + ".description") }}
                  </v-card-text>
                </div>
              </v-card>
            </v-hover>
          </v-col>
        </v-row>
      </v-container>
    </v-main>
  </v-app>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { useRouter } from "vue-router";
import { availableGames } from "../constants/games";
import ThemeSwitcher from "../components/ThemeSwitcher.vue";

import { useAuthStore } from "../store/auth";
import { useUIStore } from "../store/ui";

const router = useRouter();
const authStore = useAuthStore();
const uiStore = useUIStore();

const drawer = ref(true);
const selectedCategory = ref("All");
const joinedRooms = ref<any[]>([]);
const leavingId = ref<string | null>(null);

const API_BASE = "http://127.0.0.1:3000";

const categories = computed(() => {
  const cats = new Set(availableGames.map((g) => g.category));
  return Array.from(cats).sort();
});

const filteredGames = computed(() => {
  if (selectedCategory.value === "All") return availableGames;
  return availableGames.filter((g) => g.category === selectedCategory.value);
});

const fetchJoinedRooms = async () => {
  try {
    const token = authStore.token;
    const res = await fetch(`${API_BASE}/rooms/my`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    joinedRooms.value = data.rooms || [];
  } catch (err) {
    console.error("Failed to fetch joined rooms:", err);
  }
};

onMounted(fetchJoinedRooms);

const getGameEmoji = (type: string) => {
  const game = availableGames.find((g) => g.type === type.toLowerCase());
  return game?.emoji || "🎮";
};

const onGameSelected = (type: string, roomId?: string) => {
  if (roomId) {
    router.push(`/game/${type}/${roomId}`);
  } else {
    router.push(`/rooms/${type}`);
  }
};

const leaveRoom = async (roomId: string) => {
  if (leavingId.value) return;
  leavingId.value = roomId;
  try {
    const token = authStore.token;
    const res = await fetch(`${API_BASE}/game/${roomId}/leave`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      await fetchJoinedRooms();
    }
  } catch (err) {
    console.error("Failed to leave room:", err);
  } finally {
    leavingId.value = null;
  }
};

const logout = () => {
  authStore.logout();
  router.push("/login");
};

import { useI18n } from "vue-i18n";
const { locale } = useI18n();

const setLocale = (lang: string) => {
  uiStore.setLocale(lang);
  locale.value = lang;
};
</script>

<style scoped>
.game-card {
  transition:
    transform 0.3s ease,
    box-shadow 0.3s ease;
  cursor: pointer;
  background: rgba(var(--v-theme-on-surface), 0.03);
  border: 1px solid rgba(var(--v-theme-on-surface), 0.05);
}

.game-card.on-hover {
  transform: translateY(-8px);
  background: rgba(255, 255, 255, 0.06);
  border-color: rgba(var(--v-theme-primary), 0.5);
}

.text-primary {
  color: rgb(var(--v-theme-primary)) !important;
}
</style>
