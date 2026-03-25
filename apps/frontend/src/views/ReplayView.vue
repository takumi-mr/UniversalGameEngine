<template>
  <GenericReplayView
    :game-type="route.params.gameType as string"
    :game-emoji="gameEmoji"
    :record-id="recordId"
  />
</template>

<script setup lang="ts">
import { computed } from "vue";
import GenericReplayView from "../components/GenericReplayView.vue";
import { useRoute } from "vue-router";

const route = useRoute();
const gameEmoji = "🎲"; // 実際にはゲームタイプに応じて動的に設定
const recordId = computed(() => {
  const id = route.params.recordId;
  return Array.isArray(id) ? id[0] : id || undefined;
});
</script>
