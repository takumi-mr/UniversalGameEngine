<template>
  <div class="equilibrium-help">
    <v-tabs v-model="activeTab" color="primary" grow class="mb-4">
      <v-tab v-for="(_, key) in tabConfigs" :key="key" :value="key">
        {{ $t(`games.equilibrium.tabs.${key}.label`) }}
      </v-tab>
    </v-tabs>

    <v-window v-model="activeTab">
      <v-window-item v-for="(config, key) in tabConfigs" :key="key" :value="key">
        <div class="pa-4 help-tab-content">
          <div class="d-flex align-center mb-4">
            <v-avatar :color="config.color" variant="tonal" class="mr-3" size="40">
              <v-icon :icon="config.icon" />
            </v-avatar>
            <h3 class="text-h6 font-weight-bold">
              {{ $t(`games.equilibrium.tabs.${key}.title`) }}
            </h3>
          </div>

          <div class="text-body-1 content-text whitespace-pre-wrap">
            {{ $t(`games.equilibrium.tabs.${key}.content`) }}
          </div>

          <v-alert
            v-if="key === 'summary'"
            type="info"
            variant="tonal"
            class="mt-6"
            border="start"
            density="compact"
          >
            {{ $t("games.equilibrium.description") }}
          </v-alert>
        </div>
      </v-window-item>
    </v-window>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";

const activeTab = ref("summary");

const tabConfigs = {
  summary: { icon: "mdi-auto-fix", color: "primary" },
  goals: { icon: "mdi-trophy-outline", color: "warning" },
  phases: { icon: "mdi-sync", color: "info" },
  cards: { icon: "mdi-cards-outline", color: "success" },
};
</script>

<style scoped>
.equilibrium-help {
  min-height: 350px;
}

.help-tab-content {
  animation: fade-in 0.3s ease-out;
}

.content-text {
  line-height: 1.8;
  color: rgba(var(--v-theme-on-surface), 0.87);
}

.whitespace-pre-wrap {
  white-space: pre-wrap;
}

@keyframes fade-in {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* Customizing scrollbar for the dialog content if it overflows */
.help-tab-content::-webkit-scrollbar {
  width: 6px;
}
.help-tab-content::-webkit-scrollbar-thumb {
  background: rgba(var(--v-theme-primary), 0.2);
  border-radius: 10px;
}
</style>
