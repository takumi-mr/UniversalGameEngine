<template>
  <v-menu offset-y>
    <template #activator="{ props }">
      <v-btn icon v-bind="props" :color="currentThemeColor">
        <v-icon>{{ currentThemeIcon }}</v-icon>
      </v-btn>
    </template>
    <v-list>
      <v-list-item
        v-for="item in themes"
        :key="item.id"
        :prepend-icon="item.icon"
        :title="item.name"
        :active="currentTheme === item.id"
        @click="setTheme(item.id)"
      />
    </v-list>
  </v-menu>
</template>

<script setup lang="ts">
import { computed, watch } from "vue";
import { useTheme } from "vuetify";
import { useUIStore } from "../store/ui";

const theme = useTheme();
const uiStore = useUIStore();

const themes = [
  { id: "light", name: "Light", icon: "mdi-white-balance-sunny" },
  { id: "dark", name: "Dark", icon: "mdi-weather-night" },
  { id: "cyberpunk", name: "Cyberpunk", icon: "mdi-robot" },
  { id: "forest", name: "Forest", icon: "mdi-tree" },
];

const currentTheme = computed(() => uiStore.theme);

const currentThemeIcon = computed(() => {
  return themes.find((t) => t.id === currentTheme.value)?.icon || "mdi-palette";
});

const currentThemeColor = computed(() => {
  if (currentTheme.value === "cyberpunk") return "primary";
  if (currentTheme.value === "forest") return "primary";
  return "";
});

const setTheme = (themeId: string) => {
  uiStore.setTheme(themeId);
  theme.global.name.value = themeId;
};

// Sync store theme with Vuetify theme
watch(
  () => uiStore.theme,
  (newTheme) => {
    theme.global.name.value = newTheme;
  },
  { immediate: true },
);
</script>
