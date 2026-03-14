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
        ></v-list-item>
        
        <v-divider class="my-2"></v-divider>
        
        <v-list-item
          v-for="cat in categories"
          :key="cat"
          :title="$t('categories.' + cat)"
          prepend-icon="mdi-folder-outline"
          :active="selectedCategory === cat"
          @click="selectedCategory = cat"
        ></v-list-item>
      </v-list>
      
      <template v-slot:append>
        <div class="pa-4">
          <v-btn block color="error" variant="tonal" prepend-icon="mdi-logout" @click="logout">
            {{ $t('common.logout') }}
          </v-btn>
        </div>
      </template>
    </v-navigation-drawer>

    <!-- Top App Bar -->
    <v-app-bar flat border="none" color="surface">
      <v-app-bar-title class="text-h5 font-weight-bold">
        <span class="text-primary">Universal</span> {{ $t('common.title').split(' ').slice(1).join(' ') || 'Game Engine' }}
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

      <div class="px-4 text-body-2 text-medium-emphasis">
        {{ $t('common.logged_in_as', { username: username }) }}
      </div>
    </v-app-bar>

    <!-- Main Content -->
    <v-main style="height: 100vh; overflow-y: auto;">
      <v-container class="pa-6" fluid>
        <div class="mb-6">
          <h2 class="text-h4 font-weight-bold mb-2">{{ $t('categories.' + selectedCategory) }}</h2>
          <p class="text-body-1 text-medium-emphasis">{{ $t('common.select_game_desc') }}</p>
        </div>

        <v-row>
          <v-col
            v-for="game in filteredGames"
            :key="game.type"
            cols="12"
            sm="6"
            md="4"
            lg="3"
          >
            <v-hover v-slot="{ isHovering, props }">
              <v-card
                v-bind="props"
                :elevation="isHovering ? 12 : 2"
                :class="{ 'on-hover': isHovering }"
                class="rounded-xl overflow-hidden game-card"
                @click="onGameSelected(game.type)"
              >
                <div class="pa-6 d-flex flex-column align-center text-center fill-height">
                  <div class="text-h1 mb-4">{{ game.emoji }}</div>
                  <v-card-title class="text-h5 font-weight-bold pa-0 mb-2">{{ $t('games.' + game.type + '.name') }}</v-card-title>
                  <v-card-text class="text-body-2 text-medium-emphasis pa-0">
                    {{ $t('games.' + game.type + '.description') }}
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
import { ref, computed } from 'vue';
import { useRouter } from 'vue-router';
import { availableGames } from '../constants/games';
import ThemeSwitcher from '../components/ThemeSwitcher.vue';

const router = useRouter();
const username = ref(localStorage.getItem('game_username') || 'Unknown');
const drawer = ref(true);
const selectedCategory = ref('All');

const categories = computed(() => {
  const cats = new Set(availableGames.map(g => g.category));
  return Array.from(cats).sort();
});

const filteredGames = computed(() => {
  if (selectedCategory.value === 'All') return availableGames;
  return availableGames.filter(g => g.category === selectedCategory.value);
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
.game-card {
  transition: transform 0.3s ease, box-shadow 0.3s ease;
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
