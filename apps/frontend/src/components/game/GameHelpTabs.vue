<template>
  <div class="game-help-tabs">
    <v-tabs
      v-if="hasTabs"
      v-model="activeTab"
      color="primary"
      grow
      class="mb-4"
    >
      <v-tab
        v-for="(_, key) in tabs"
        :key="key"
        :value="key"
      >
        {{ $t(`games.${gameType}.tabs.${key}.label`) }}
      </v-tab>
    </v-tabs>

    <div v-if="hasTabs">
      <v-window v-model="activeTab">
        <v-window-item
          v-for="(_, key) in tabs"
          :key="key"
          :value="key"
        >
          <div class="pa-4 help-tab-content">
            <div class="d-flex align-center mb-4">
              <v-avatar :color="getTabIcon(key).color" variant="tonal" class="mr-3" size="40">
                <v-icon :icon="getTabIcon(key).icon"></v-icon>
              </v-avatar>
              <h3 class="text-h6 font-weight-bold">{{ $t(`games.${gameType}.tabs.${key}.title`) }}</h3>
            </div>
            
            <div class="text-body-1 content-text whitespace-pre-wrap">
              {{ $t(`games.${gameType}.tabs.${key}.content`) }}
            </div>
          </div>
        </v-window-item>
      </v-window>
    </div>

    <div v-else class="pa-4">
      <div class="d-flex align-center mb-3">
        <v-icon color="primary" class="mr-2">mdi-book-open-variant</v-icon>
        <span class="text-subtitle-1 font-weight-bold text-primary">{{ $t('help.how_to_play') }}</span>
      </div>
      <p class="text-body-1 mb-0 line-height-relaxed whitespace-pre-wrap">
        {{ $t(`games.${gameType}.rules`) || $t('help.no_rules') }}
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { useI18n } from 'vue-i18n';

const props = defineProps<{
  gameType: string;
}>();

const { tm } = useI18n();

const activeTab = ref('summary');

const tabs = computed(() => {
  const path = `games.${props.gameType}.tabs`;
  const result = tm(path);
  // vue-i18n tm() returns the object or a translate function depending on config
  // We check if it's a non-empty object
  if (result && typeof result === 'object' && Object.keys(result).length > 0) {
    return result;
  }
  return null;
});

const hasTabs = computed(() => tabs.value !== null);

const getTabIcon = (key: string | number) => {
  const k = String(key);
  if (k.includes('summary')) return { icon: 'mdi-information-outline', color: 'primary' };
  if (k.includes('rule')) return { icon: 'mdi-book-open-variant', color: 'info' };
  if (k.includes('win') || k.includes('goal')) return { icon: 'mdi-trophy-outline', color: 'warning' };
  if (k.includes('piece')) return { icon: 'mdi-chess-knight', color: 'secondary' };
  if (k.includes('rank')) return { icon: 'mdi-format-list-numbered', color: 'deep-purple' };
  if (k.includes('special') || k.includes('phase')) return { icon: 'mdi-star-outline', color: 'success' };
  if (k.includes('card')) return { icon: 'mdi-cards-outline', color: 'success' };
  return { icon: 'mdi-help-circle-outline', color: 'grey' };
};
</script>

<style scoped>
.game-help-tabs {
  min-height: 300px;
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

.line-height-relaxed {
  line-height: 1.7;
}

@keyframes fade-in {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}
</style>
