<template>
  <div class="generic-replay-view">
    <div class="panel">
      <div class="panel-header">
        <div class="game-title">🎬 REPLAY: {{ gameEmoji }} {{ $t(`games.${gameType}.name`) }}</div>
        <div v-if="recordId" class="room-id">
          📁 Record ID: <span>{{ recordId }}</span>
        </div>
      </div>

      <div v-if="loading" class="connecting">
        <div class="spinner" />
        <div>Loading Replay Engine...</div>
      </div>

      <div v-else-if="errorMsg" class="error-banner">⚠️ {{ errorMsg }}</div>

      <!-- File Upload Prompt -->
      <div v-else-if="!gameRecord" class="upload-prompt">
        <div class="upload-icon">📁</div>
        <div class="upload-text">Select a GameRecord JSON file to replay.</div>
        <input ref="fileInput" type="file" accept=".json" class="d-none" @change="onFileSelected" />
        <v-btn color="primary" prepend-icon="mdi-upload" @click="triggerFileUpload">
          Upload JSON Replay
        </v-btn>
      </div>

      <div v-else-if="gameRecord && ruleset" class="game-container">
        <ReplayViewer :record="gameRecord" :ruleset="ruleset" :play-speed-ms="800">
          <template #default="{ state }">
            <component
              :is="gameComponent"
              v-if="gameComponent"
              :state="state"
              my-player-id="SPECTATOR"
            />

            <div v-else class="state-block">
              <pre class="json-view">{{ JSON.stringify(state, null, 2) }}</pre>
            </div>
          </template>
        </ReplayViewer>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, defineAsyncComponent, type Component } from "vue";
import ReplayViewer from "./ReplayViewer.vue";
import { gameRegistry } from "@engine/shared/GameRegistry";
import type { GameRecord, GameRuleset } from "@engine/shared/GameRules";

const props = defineProps<{
  gameType: string;
  gameEmoji: string;
  recordId?: string; // Made optional so file upload is natural
}>();

defineEmits<{ (e: "back"): void }>();

const loading = ref(true);
const errorMsg = ref("");
const gameRecord = ref<GameRecord<any, any> | null>(null);
const ruleset = ref<GameRuleset<any, any> | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);

const components: Record<string, Component> = {
  tictactoe: defineAsyncComponent(() => import("./game/TicTacToe.vue")),
  othello: defineAsyncComponent(() => import("./game/Othello.vue")),
  mahjong: defineAsyncComponent(() => import("./game/Mahjong.vue")),
};

const gameComponent = computed(() => components[props.gameType] || null);

onMounted(async () => {
  try {
    const definition = gameRegistry.getDefinition(props.gameType);
    if (!definition) throw new Error("Unknown game type");
    ruleset.value = definition.ruleset;
    loading.value = false;

    // Optional API fetch logic can be added here if recordId is provided in the future
    // if (props.recordId) { ... fetch from API ... }
  } catch (e: any) {
    errorMsg.value = e.message || "Failed to load replay";
    loading.value = false;
  }
});

const triggerFileUpload = () => {
  fileInput.value?.click();
};

const onFileSelected = (event: Event) => {
  const target = event.target as HTMLInputElement;
  const file = target.files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const content = e.target?.result as string;
      const parsed = JSON.parse(content) as GameRecord<any, any>;

      // Basic validation
      if (!parsed.initialState || !Array.isArray(parsed.actions)) {
        throw new Error("Invalid GameRecord format");
      }

      gameRecord.value = parsed;
      errorMsg.value = "";
    } catch (err: any) {
      errorMsg.value = "Failed to parse JSON file: " + err.message;
      gameRecord.value = null;
    }
  };
  reader.onerror = () => {
    errorMsg.value = "Failed to read file.";
  };
  reader.readAsText(file);

  // Reset input
  if (target) {
    target.value = "";
  }
};
</script>

<style scoped>
.generic-replay-view {
  display: flex;
  justify-content: center;
  align-items: center;
  height: 100vh;
}

.upload-prompt {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 64px 24px;
  text-align: center;
  background: rgba(var(--v-theme-surface), 0.5);
  border: 2px dashed rgba(var(--v-theme-on-surface), 0.2);
  border-radius: 16px;
  margin: 24px;
}

.upload-icon {
  font-size: 64px;
  margin-bottom: 16px;
  opacity: 0.8;
}

.upload-text {
  font-size: 1.2rem;
  margin-bottom: 24px;
  color: rgba(var(--v-theme-on-surface), 0.8);
}
</style>
