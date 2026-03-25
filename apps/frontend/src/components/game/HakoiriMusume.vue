<template>
  <div class="hakoiri-musume">
    <div class="game-board-container">
      <div class="stats mb-4">
        <v-chip color="primary" variant="outlined" label>
          <v-icon start icon="mdi-counter" />
          {{ $t("games.hakoiri_musume.move_count", { count: state.moveCount }) }}
        </v-chip>
        <v-spacer />
        <v-btn
          color="secondary"
          variant="text"
          prepend-icon="mdi-restart"
          size="small"
          @click="emit('action', { type: 'RESET' })"
        >
          {{ $t("games.hakoiri_musume.reset") }}
        </v-btn>
      </div>

      <div class="board-wrapper">
        <div class="grid-background">
          <div v-for="i in 20" :key="i" class="grid-cell" />
        </div>

        <div class="blocks-layer">
          <div
            v-for="block in state.blocks"
            :key="block.id"
            class="block"
            :class="[
              block.type.toLowerCase(),
              { 'last-moved': state.lastMovedBlockId === block.id },
            ]"
            :style="getBlockStyle(block)"
            @click="handleBlockClick(block)"
          >
            <div class="block-content">
              <span class="block-name">{{ block.name }}</span>
            </div>

            <!-- Direction Indicators -->
            <div v-if="selectedBlockId === block.id" class="move-indicators">
              <v-btn
                v-for="dir in getPossibleDirections(block)"
                :key="dir"
                icon
                size="x-small"
                color="primary"
                class="indicator-btn"
                :class="`dir-${dir}`"
                @click.stop="moveBlock(block.id, dir)"
              >
                <v-icon>{{ getDirIcon(dir) }}</v-icon>
              </v-btn>
            </div>
          </div>
        </div>

        <!-- Exit Indicator -->
        <div class="exit-gate">
          <span>EXIT</span>
        </div>
      </div>

      <div v-if="state.status === 'FINISHED'" class="win-banner mt-6">
        <v-alert
          type="success"
          variant="tonal"
          border="start"
          :title="state.message"
          icon="mdi-trophy"
        >
          {{ $t("games.hakoiri_musume.tabs.win.content") }}
        </v-alert>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import type { HakoiriMusumeState, Block } from "@engine/shared/rules/HakoiriMusumeRuleset";

const props = defineProps<{
  state: HakoiriMusumeState;
  myPlayerId: string;
}>();

const emit = defineEmits<{
  (e: "action", action: any): void;
}>();

const selectedBlockId = ref<string | null>(null);

const getBlockStyle = (block: Block) => {
  const cellSize = 60; // Base cell size in px
  const gap = 4;
  return {
    width: `${block.width * cellSize + (block.width - 1) * gap}px`,
    height: `${block.height * cellSize + (block.height - 1) * gap}px`,
    transform: `translate(${block.x * (cellSize + gap)}px, ${block.y * (cellSize + gap)}px)`,
  };
};

const handleBlockClick = (block: Block) => {
  if (props.state.status !== "PLAYING") return;

  const possible = getPossibleDirections(block);
  if (possible.length === 0) {
    selectedBlockId.value = null;
    return;
  }

  if (possible.length === 1) {
    moveBlock(block.id, possible[0]);
    selectedBlockId.value = null;
  } else {
    // If multiple directions possible, show indicators
    selectedBlockId.value = selectedBlockId.value === block.id ? null : block.id;
  }
};

const moveBlock = (blockId: string, direction: "U" | "D" | "L" | "R") => {
  emit("action", {
    type: "MOVE",
    blockId,
    direction,
    playerId: props.myPlayerId,
  });
};

const getPossibleDirections = (block: Block) => {
  const directions: ("U" | "D" | "L" | "R")[] = ["U", "D", "L", "R"];
  return directions.filter((dir) => {
    let nx = block.x;
    let ny = block.y;
    if (dir === "U") ny--;
    if (dir === "D") ny++;
    if (dir === "L") nx--;
    if (dir === "R") nx++;

    // Border
    if (nx < 0 || ny < 0 || nx + block.width > 4 || ny + block.height > 5) return false;

    // Collision
    return !props.state.blocks.some((other) => {
      if (other.id === block.id) return false;
      return (
        nx < other.x + other.width &&
        nx + block.width > other.x &&
        ny < other.y + other.height &&
        ny + block.height > other.y
      );
    });
  });
};

const getDirIcon = (dir: string) => {
  if (dir === "U") return "mdi-chevron-up";
  if (dir === "D") return "mdi-chevron-down";
  if (dir === "L") return "mdi-chevron-left";
  if (dir === "R") return "mdi-chevron-right";
  return "";
};
</script>

<style scoped>
.hakoiri-musume {
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 20px;
  height: 100%;
}

.game-board-container {
  display: flex;
  flex-direction: column;
  align-items: center;
}

.stats {
  display: flex;
  width: 100%;
  max-width: 260px;
  align-items: center;
}

.board-wrapper {
  position: relative;
  width: 252px; /* 4 * 60 + 3 * 4 */
  height: 316px; /* 5 * 60 + 4 * 4 */
  padding: 4px;
  background: #3e2723;
  border-radius: 8px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
  border: 4px solid #5d4037;
}

.grid-background {
  display: grid;
  grid-template-columns: repeat(4, 60px);
  grid-template-rows: repeat(5, 60px);
  gap: 4px;
}

.grid-cell {
  background: rgba(255, 255, 255, 0.05);
  border-radius: 4px;
}

.blocks-layer {
  position: absolute;
  top: 4px;
  left: 4px;
  width: 100%;
  height: 100%;
}

.block {
  position: absolute;
  cursor: pointer;
  transition: transform 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  z-index: 10;
  user-select: none;
}

.block:hover .block-content {
  filter: brightness(1.1);
  transform: scale(0.98);
}

.block-content {
  width: 100%;
  height: 100%;
  border-radius: 6px;
  display: flex;
  justify-content: center;
  align-items: center;
  font-weight: bold;
  box-shadow:
    inset 0 2px 4px rgba(255, 255, 255, 0.3),
    0 4px 8px rgba(0, 0, 0, 0.3);
  transition: all 0.2s;
}

.block.musume .block-content {
  background: linear-gradient(135deg, #ff80ab, #f06292);
  color: white;
  font-size: 1.2rem;
  border: 2px solid #ad1457;
}

.block.vertical .block-content {
  background: linear-gradient(135deg, #90caf9, #42a5f5);
  color: white;
  border: 2px solid #1565c0;
}

.block.horizontal .block-content {
  background: linear-gradient(135deg, #a5d6a7, #66bb6a);
  color: white;
  border: 2px solid #2e7d32;
}

.block.small .block-content {
  background: linear-gradient(135deg, #fff59d, #fbc02d);
  color: #5d4037;
  border: 2px solid #f9a825;
}

.block.last-moved {
  z-index: 11;
}

.block-name {
  pointer-events: none;
}

.exit-gate {
  position: absolute;
  bottom: -12px;
  left: 64px; /* Skip Father */
  width: 124px; /* Width of Musume + 1 gap */
  height: 8px;
  background: #ff5252;
  border-radius: 0 0 10px 10px;
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 5;
}

.exit-gate span {
  font-size: 8px;
  color: white;
  font-weight: 900;
  letter-spacing: 2px;
}

/* Indicators */
.move-indicators {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}

.indicator-btn {
  position: absolute;
  pointer-events: auto;
  z-index: 20;
}

.dir-U {
  top: -15px;
  left: calc(50% - 15px);
}
.dir-D {
  bottom: -15px;
  left: calc(50% - 15px);
}
.dir-L {
  left: -15px;
  top: calc(50% - 15px);
}
.dir-R {
  right: -15px;
  top: calc(50% - 15px);
}

.win-banner {
  width: 100%;
  max-width: 350px;
}
</style>
