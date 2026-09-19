<template>
  <v-menu :close-on-content-click="false" offset-y>
    <template #activator="{ props: activator }">
      <v-btn icon v-bind="activator" :title="$t('common.sound.title')">
        <v-icon>{{ soundStore.muted ? "mdi-volume-off" : "mdi-volume-high" }}</v-icon>
      </v-btn>
    </template>
    <v-card min-width="260" class="pa-4">
      <div class="d-flex align-center justify-space-between mb-2">
        <span class="text-subtitle-2">{{ $t("common.sound.title") }}</span>
        <v-switch
          :model-value="!soundStore.muted"
          :label="$t('common.sound.enabled')"
          color="primary"
          density="compact"
          hide-details
          @update:model-value="soundStore.setMuted(!$event)"
        />
      </div>
      <v-slider
        :model-value="soundStore.masterVolume"
        :label="$t('common.sound.master')"
        :disabled="soundStore.muted"
        min="0"
        max="1"
        step="0.05"
        prepend-icon="mdi-volume-medium"
        density="compact"
        hide-details
        @update:model-value="soundStore.setMasterVolume($event)"
      />
      <v-slider
        :model-value="soundStore.bgmVolume"
        :label="$t('common.sound.bgm')"
        :disabled="soundStore.muted"
        min="0"
        max="1"
        step="0.05"
        prepend-icon="mdi-music"
        density="compact"
        hide-details
        @update:model-value="soundStore.setBgmVolume($event)"
      />
      <v-slider
        :model-value="soundStore.seVolume"
        :label="$t('common.sound.se')"
        :disabled="soundStore.muted"
        min="0"
        max="1"
        step="0.05"
        prepend-icon="mdi-bell-ring-outline"
        density="compact"
        hide-details
        @update:model-value="soundStore.setSeVolume($event)"
      />
    </v-card>
  </v-menu>
</template>

<script setup lang="ts">
import { useSoundStore } from "@/store/sound";

// 効果音・BGM の音量とミュート。設定は sound store が localStorage に保存する
const soundStore = useSoundStore();
</script>
