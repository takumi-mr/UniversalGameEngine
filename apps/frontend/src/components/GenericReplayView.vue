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
              :game-id="recordId ?? 'replay'"
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
import { ref, computed, onMounted } from "vue";
import ReplayViewer from "@/components/ReplayViewer.vue";
import { getReplayComponent } from "@/games/registry";
import { gameRegistry } from "@engine/shared/GameRegistry";
import type {
  GameRecord,
  GameRuleset,
  BaseGameState,
  BaseGameAction,
} from "@engine/shared/GameRules";

const props = defineProps<{
  gameType: string;
  gameEmoji: string;
  recordId?: string; // Made optional so file upload is natural
}>();

defineEmits<{ (e: "back"): void }>();

const loading = ref(true);
const errorMsg = ref("");
type AnyGameRecord = GameRecord<BaseGameState, BaseGameAction>;
const gameRecord = ref<AnyGameRecord | null>(null);
const ruleset = ref<GameRuleset<BaseGameState, BaseGameAction> | null>(null);

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));
const fileInput = ref<HTMLInputElement | null>(null);

// 盤面コンポーネントは src/games/<type>/index.ts の定義から引く（replay: false のゲームは JSON 表示）
const gameComponent = computed(() => getReplayComponent(props.gameType));

onMounted(async () => {
  try {
    const definition = gameRegistry.getDefinition(props.gameType);
    if (!definition) throw new Error("Unknown game type");
    ruleset.value = definition.ruleset;
    loading.value = false;

    // recordId がある場合は API から取得を試みる
    if (props.recordId) {
      fetchGameRecord(props.recordId);
    }
  } catch (e) {
    errorMsg.value = errorText(e) || "Failed to load replay";
    loading.value = false;
  }
});

const fetchGameRecord = async (id: string) => {
  loading.value = true;
  errorMsg.value = "";
  try {
    const response = await fetch(`${import.meta.env.VITE_API_BASE_URL || ""}/replays/${id}`);
    if (!response.ok) {
      if (response.status === 404) {
        throw new Error("Game record not found on server.");
      }
      throw new Error(`Failed to fetch: ${response.statusText}`);
    }
    const data: AnyGameRecord = await response.json();
    gameRecord.value = data;
  } catch (err) {
    console.error("Fetch error:", err);
    errorMsg.value = "Failed to load replay from server: " + errorText(err);
  } finally {
    loading.value = false;
  }
};

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
      const parsed = JSON.parse(content) as AnyGameRecord;

      // Basic validation
      if (!parsed.initialState || !Array.isArray(parsed.actions)) {
        throw new Error("Invalid GameRecord format");
      }

      gameRecord.value = parsed;
      errorMsg.value = "";
    } catch (err) {
      errorMsg.value = "Failed to parse JSON file: " + errorText(err);
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
