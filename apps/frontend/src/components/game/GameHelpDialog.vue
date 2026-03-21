<template>
  <v-dialog
    v-model="internalModel"
    max-width="600px"
    transition="dialog-bottom-transition"
  >
    <v-card class="help-card pt-4 pb-2 px-2">
      <v-card-title class="d-flex align-center justify-space-between pb-4">
        <div class="d-flex align-center">
          <v-avatar
            color="primary"
            variant="tonal"
            size="48"
            class="mr-4"
          >
            <span class="text-h5">{{ gameEmoji }}</span>
          </v-avatar>
          <div>
            <div class="text-h5 font-weight-bold">
              {{ gameName }}
            </div>
            <div class="text-caption text-medium-emphasis">
              {{ $t('help.title') }}
            </div>
          </div>
        </div>
        <v-btn
          icon="mdi-close"
          variant="text"
          @click="internalModel = false"
        />
      </v-card-title>

      <v-divider />

      <v-card-text class="py-6 rules-content">
        <slot name="custom">
          <div class="rules-section">
            <div class="d-flex align-center mb-3">
              <v-icon
                color="primary"
                class="mr-2"
              >
                mdi-book-open-variant
              </v-icon>
              <span class="text-subtitle-1 font-weight-bold text-primary">{{ $t('help.how_to_play') }}</span>
            </div>
            <p class="text-body-1 mb-0 line-height-relaxed whitespace-pre-wrap">
              {{ gameRules || $t('help.no_rules') }}
            </p>
          </div>

          <div
            v-if="gameDescription"
            class="rules-section mt-6"
          >
            <div class="d-flex align-center mb-3">
              <v-icon
                color="secondary"
                class="mr-2"
              >
                mdi-information-outline
              </v-icon>
              <span class="text-subtitle-1 font-weight-bold text-secondary">{{ $t('help.summary') }}</span>
            </div>
            <p class="text-body-2 text-medium-emphasis mb-0">
              {{ gameDescription }}
            </p>
          </div>
        </slot>
      </v-card-text>

      <v-divider />

      <v-card-actions class="pa-4 flex-column align-stretch">
        <v-btn
          block
          color="primary"
          variant="flat"
          size="large"
          @click="internalModel = false"
        >
          {{ $t('help.ok') }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{
  modelValue: boolean;
  gameName: string;
  gameEmoji: string;
  gameRules?: string;
  gameDescription?: string;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void;
}>();

const internalModel = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value),
});
</script>

<style scoped>
.help-card {
  border-radius: 16px !important;
  overflow: hidden;
  background: rgba(var(--v-theme-surface), 0.9) !important;
  backdrop-filter: blur(10px);
  border: 1px solid rgba(255, 255, 255, 0.1);
}

.rules-content {
  min-height: 100px;
}

.line-height-relaxed {
  line-height: 1.7;
}

.whitespace-pre-wrap {
  white-space: pre-wrap;
}

.rules-section {
  position: relative;
}
</style>
