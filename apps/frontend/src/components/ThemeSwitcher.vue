<template>
  <v-menu offset-y>
    <template v-slot:activator="{ props }">
      <v-btn icon v-bind="props" :color="currentThemeColor">
        <v-icon>{{ currentThemeIcon }}</v-icon>
      </v-btn>
    </template>
    <v-list>
      <v-list-item
        v-for="theme in themes"
        :key="theme.id"
        @click="setTheme(theme.id)"
        :prepend-icon="theme.icon"
        :title="theme.name"
        :active="currentTheme === theme.id"
      >
      </v-list-item>
    </v-list>
  </v-menu>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { useTheme } from 'vuetify';

const theme = useTheme();

const themes = [
  { id: 'light', name: 'Light', icon: 'mdi-white-balance-sunny' },
  { id: 'dark', name: 'Dark', icon: 'mdi-weather-night' },
  { id: 'cyberpunk', name: 'Cyberpunk', icon: 'mdi-robot' },
  { id: 'forest', name: 'Forest', icon: 'mdi-tree' },
];

const currentTheme = computed(() => theme.global.name.value);

const currentThemeIcon = computed(() => {
  return themes.find((t) => t.id === currentTheme.value)?.icon || 'mdi-palette';
});

const currentThemeColor = computed(() => {
  if (currentTheme.value === 'cyberpunk') return 'primary';
  if (currentTheme.value === 'forest') return 'primary';
  return '';
});

const setTheme = (themeId: string) => {
  theme.global.name.value = themeId;
  localStorage.setItem('user-theme', themeId);
};

onMounted(() => {
  const savedTheme = localStorage.getItem('user-theme');
  if (savedTheme && themes.find((t) => t.id === savedTheme)) {
    theme.global.name.value = savedTheme;
  }
});
</script>
