<template>
  <div class="replay-viewer">
    <!-- Game Board / Render Slot -->
    <div class="view-area">
      <slot
        :state="states[currentStep]"
        :current-action="actions[currentStep - 1] || null"
        :step="currentStep"
      ></slot>
    </div>

    <!-- Playback Controls -->
    <div class="playback-controls">
      <!-- Scrub Bar -->
      <div class="slider-container">
        <span class="step-label">{{ currentStep }} / {{ maxSteps }}</span>
        <input
          v-model.number="currentStep"
          type="range"
          min="0"
          :max="maxSteps"
          class="scrub-slider"
          @input="pause"
        />
      </div>

      <!-- Action Buttons -->
      <div class="actions-row">
        <v-btn
          icon="mdi-skip-previous"
          variant="text"
          :disabled="currentStep === 0"
          @click="goToStep(0)"
        />
        <v-btn
          icon="mdi-step-backward"
          variant="text"
          :disabled="currentStep === 0"
          @click="prevStep"
        />

        <v-btn
          :icon="isPlaying ? 'mdi-pause' : 'mdi-play'"
          color="primary"
          variant="flat"
          size="large"
          class="play-btn"
          @click="togglePlay"
        />

        <v-btn
          icon="mdi-step-forward"
          variant="text"
          :disabled="currentStep === maxSteps"
          @click="nextStep"
        />
        <v-btn
          icon="mdi-skip-next"
          variant="text"
          :disabled="currentStep === maxSteps"
          @click="goToStep(maxSteps)"
        />
      </div>

      <!-- Autoplay Speed Control -->
      <div class="speed-control">
        <label for="speedSelect">Speed:</label>
        <select id="speedSelect" v-model.number="currentPlaySpeedMs" @change="updateSpeed">
          <option value="2000">0.5x</option>
          <option value="1000">1x</option>
          <option value="500">2x</option>
          <option value="250">4x</option>
        </select>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onUnmounted } from "vue";
import type {
  GameRecord,
  GameRuleset,
  BaseGameState,
  BaseGameAction,
} from "@engine/shared/GameRules";
import { ProvablyFairRNG } from "@engine/shared/utils/ProvablyFairRNG";
import { deepFreeze } from "@engine/shared/utils/freeze";

const props = defineProps<{
  record: GameRecord<any, any>;
  ruleset: GameRuleset<any, any>;
  playSpeedMs?: number;
}>();

const states = ref<BaseGameState[]>([]);
const actions = computed<BaseGameAction[]>(() => props.record.actions);
const maxSteps = computed(() => actions.value.length);
const currentStep = ref(0);

const isPlaying = ref(false);
const currentPlaySpeedMs = ref(props.playSpeedMs || 1000);
let playInterval: number | null = null;

// Reconstruct all states on mount or when record changes
const reconstructStates = () => {
  const reconstructed: BaseGameState[] = [];

  // First state is exactly the initialState logged
  // Note: we deep clone to avoid mutating it later just in case
  let state = JSON.parse(JSON.stringify(props.record.initialState));
  reconstructed.push(state);

  // Re-instantiate the exact RNG if we have the server seed
  let rng: ProvablyFairRNG | undefined = undefined;
  if (props.record.finalServerSeed && props.record.clientSeed) {
    // Initial nonce depends on how many times RNG was called before actions started.
    // Usually UniversalEngine starts nonce at 0 and increments it internally.
    // The state's prngConfig holds the nonce we should start at.
    const startNonce = state.prngConfig ? state.prngConfig.nonce : 0;
    rng = new ProvablyFairRNG(props.record.finalServerSeed, props.record.clientSeed, startNonce);
  }

  // Sequentially apply each action
  for (const action of props.record.actions) {
    const clonedState = JSON.parse(JSON.stringify(state));
    // Development deep freeze check
    if (process.env.NODE_ENV !== "production") {
      deepFreeze(clonedState);
    }

    // Reduce uses the rng to mutate its sequence correctly
    state = props.ruleset.reduce(clonedState, action, rng);

    if (rng && state.prngConfig) {
      // match the engine's behavior: update the state's nonce tracking
      state.prngConfig.nonce = rng.getNonce();
    }
    reconstructed.push(state);
  }

  states.value = reconstructed;
  currentStep.value = 0;
  pause();
};

watch(() => props.record, reconstructStates, { deep: true, immediate: true });

// --- Playback Controls ---
const togglePlay = () => {
  if (isPlaying.value) {
    pause();
  } else {
    play();
  }
};

const play = () => {
  if (currentStep.value >= maxSteps.value) {
    // If at the end, restart
    currentStep.value = 0;
  }
  isPlaying.value = true;
  playInterval = window.setInterval(() => {
    if (currentStep.value < maxSteps.value) {
      currentStep.value++;
    } else {
      pause();
    }
  }, currentPlaySpeedMs.value);
};

const pause = () => {
  isPlaying.value = false;
  if (playInterval !== null) {
    clearInterval(playInterval);
    playInterval = null;
  }
};

const updateSpeed = () => {
  if (isPlaying.value) {
    pause();
    play();
  }
};

const nextStep = () => {
  pause();
  if (currentStep.value < maxSteps.value) currentStep.value++;
};

const prevStep = () => {
  pause();
  if (currentStep.value > 0) currentStep.value--;
};

const goToStep = (step: number) => {
  pause();
  currentStep.value = Math.max(0, Math.min(step, maxSteps.value));
};

onUnmounted(() => {
  pause();
});
</script>

<style scoped>
.replay-viewer {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.view-area {
  flex: 1;
  display: flex;
  justify-content: center;
  align-items: center;
  overflow: auto;
  padding: 16px;
}

.playback-controls {
  background: rgba(var(--v-theme-surface), 0.8);
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.1);
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.slider-container {
  display: flex;
  align-items: center;
  gap: 16px;
}

.step-label {
  font-family: monospace;
  min-width: 60px;
  text-align: right;
  font-size: 0.9rem;
  color: rgba(var(--v-theme-on-surface), 0.7);
}

.scrub-slider {
  flex: 1;
  cursor: pointer;
  accent-color: rgb(var(--v-theme-primary));
}

.actions-row {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 16px;
}

.play-btn {
  width: 56px;
  height: 56px;
  border-radius: 50%;
}

.speed-control {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 8px;
  font-size: 0.85rem;
  color: rgba(var(--v-theme-on-surface), 0.6);
}

.speed-control select {
  background: transparent;
  color: inherit;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.2);
  border-radius: 4px;
  padding: 2px 6px;
  outline: none;
}
</style>
