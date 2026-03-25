<template>
  <div class="logic-lab-container">
    <div class="game-header">
      <div v-if="'currentLevelId' in state" class="level-info">
        <h2 class="text-h5 font-weight-bold">{{ level?.name }}</h2>
        <p class="text-caption opacity-70">{{ level?.description }}</p>
      </div>
      <div v-else class="sandbox-info">
        <h2 class="text-h5 font-weight-bold">Circuit Sandbox</h2>
      </div>
      <div class="actions">
        <v-btn icon="mdi-refresh" variant="text" @click="emit('action', { type: 'RESET' })"></v-btn>
        <v-btn
          v-if="'currentLevelId' in state"
          color="primary"
          @click="emit('action', { type: 'CHECK_SOLUTION' })"
        >
          Check Solution
        </v-btn>
      </div>
    </div>

    <div class="main-layout">
      <!-- Toolbar -->
      <div class="toolbar">
        <v-card variant="outlined" class="pa-2">
          <div class="text-overline mb-2">Gates</div>
          <div class="gate-grid">
            <v-btn
              v-for="gate in allowedGates"
              :key="gate"
              size="small"
              variant="tonal"
              class="mb-2"
              @click="addBlock(gate)"
            >
              {{ gate }}
            </v-btn>
          </div>
        </v-card>

        <v-card
          v-if="'testResults' in state && (state as any).testResults?.length"
          variant="outlined"
          class="pa-2 mt-4"
        >
          <div class="text-overline mb-2">Test Results</div>
          <div v-for="(res, idx) in (state as any).testResults" :key="idx" class="test-item">
            <v-icon :color="res ? 'success' : 'error'">
              {{ res ? "mdi-check-circle" : "mdi-close-circle" }}
            </v-icon>
            <span class="ml-2">Test {{ Number(idx) + 1 }}</span>
          </div>
        </v-card>
      </div>

      <!-- Canvas -->
      <div ref="canvasContainer" class="canvas-container" @mousedown="onCanvasMouseDown">
        <svg
          class="logic-svg"
          :width="canvasWidth"
          :height="canvasHeight"
          @mousemove="onMouseMove"
          @mouseup="onMouseUp"
        >
          <!-- Grid -->
          <defs>
            <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
              <path
                d="M 20 0 L 0 0 0 20"
                fill="none"
                stroke="rgba(255,255,255,0.05)"
                stroke-width="0.5"
              />
            </pattern>
            pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#grid)" />

          <!-- Connections -->
          <path
            v-for="(conn, idx) in state.connections"
            :key="'conn-' + idx"
            :d="getConnectionPath(conn)"
            class="connection-wire"
            :class="{ active: isWireActive(conn) }"
            fill="none"
            stroke-width="3"
            @click="removeConnection(conn)"
          />

          <!-- Active Drag Connection -->
          <path
            v-if="draggingPin"
            :d="getDragPath()"
            class="connection-wire dragging"
            fill="none"
            stroke-dasharray="5,5"
            stroke-width="2"
          />

          <!-- Blocks -->
          <g
            v-for="block in state.blocks"
            :key="block.id"
            :transform="`translate(${block.x || 100}, ${block.y || 100})`"
            @mousedown.stop="startDragBlock(block, $event)"
          >
            <rect
              width="80"
              height="50"
              rx="8"
              class="block-bg"
              :class="{ 'is-active': block.value === 1 }"
            />
            <text x="40" y="30" text-anchor="middle" class="block-label">{{ block.type }}</text>

            <!-- Input Pins -->
            <circle
              v-for="i in getInputPinCount(block)"
              :key="'in-' + i"
              cx="0"
              :cy="10 + i * 10"
              r="5"
              class="pin input-pin"
              @mouseup.stop="onPinMouseUp(block.id, i - 1, 'in')"
            />

            <!-- Output Pin -->
            <circle
              cx="80"
              cy="25"
              r="5"
              class="pin output-pin"
              :class="{ 'is-active': block.value === 1 }"
              @mousedown.stop="onPinMouseDown(block.id, 0, 'out')"
            />

            <!-- Remove Button -->
            <circle cx="75" cy="5" r="8" class="remove-btn" @click.stop="removeBlock(block.id)" />
            <text x="75" y="8" text-anchor="middle" class="remove-icon">×</text>
          </g>
        </svg>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from "vue";
import { type LogicLabState, LOGIC_LAB_LEVELS } from "@engine/shared/rules/LogicLabRuleset";
import { type LogicCircuitState } from "@engine/shared/rules/LogicCircuitRuleset";

const props = defineProps<{
  state: LogicLabState | LogicCircuitState;
  myPlayerId?: string;
}>();

const emit = defineEmits<{ (e: "action", action: any): void }>();

const canvasContainer = ref<HTMLElement | null>(null);
const canvasWidth = ref(800);
const canvasHeight = ref(600);

const level = computed(() => {
  if ("currentLevelId" in props.state) {
    const s = props.state as LogicLabState;
    return LOGIC_LAB_LEVELS.find((l) => l.id === s.currentLevelId) || null;
  }
  return null;
});

const allowedGates = computed(() => {
  if ("currentLevelId" in props.state) {
    const s = props.state as LogicLabState;
    const l = LOGIC_LAB_LEVELS.find((lvl) => lvl.id === s.currentLevelId);
    return l?.allowedGates || [];
  }
  return [
    "AND",
    "OR",
    "NOT",
    "NAND",
    "NOR",
    "XOR",
    "XNOR",
    "BUFFER",
    "SWITCH",
    "LED",
    "D_FLIP_FLOP",
  ];
});

// Dragging Logic
const draggingBlock = ref<any>(null);
const draggingPin = ref<{
  blockId: string;
  pinIndex: number;
  type: "in" | "out";
  x: number;
  y: number;
} | null>(null);
const mousePos = ref({ x: 0, y: 0 });
const dragOffset = ref({ x: 0, y: 0 });

const onCanvasMouseDown = (_e: MouseEvent) => {
  // Deselect or handle background clicks
};

const onMouseMove = (e: MouseEvent) => {
  const rect = (e.currentTarget as SVGElement).getBoundingClientRect();
  mousePos.value = {
    x: e.clientX - rect.left,
    y: e.clientY - rect.top,
  };

  if (draggingBlock.value) {
    const newX = Math.round((mousePos.value.x - dragOffset.value.x) / 10) * 10;
    const newY = Math.round((mousePos.value.y - dragOffset.value.y) / 10) * 10;
    emit("action", { type: "MOVE_BLOCK", blockId: draggingBlock.value.id, x: newX, y: newY });
  }
};

const onMouseUp = () => {
  draggingBlock.value = null;
  draggingPin.value = null;
};

const startDragBlock = (block: any, _e: MouseEvent) => {
  draggingBlock.value = block;
  dragOffset.value = {
    x: mousePos.value.x - (block.x || 100),
    y: mousePos.value.y - (block.y || 100),
  };
};

const onPinMouseDown = (blockId: string, pinIndex: number, type: "in" | "out") => {
  const block = props.state.blocks[blockId];
  draggingPin.value = {
    blockId,
    pinIndex,
    type,
    x: (block.x || 100) + (type === "out" ? 80 : 0),
    y: (block.y || 100) + 25,
  };
};

const onPinMouseUp = (blockId: string, pinIndex: number, type: "in" | "out") => {
  if (draggingPin.value && draggingPin.value.type !== type) {
    const fromId = type === "out" ? blockId : draggingPin.value.blockId;
    const toId = type === "in" ? blockId : draggingPin.value.blockId;
    const toPin = type === "in" ? pinIndex : draggingPin.value.pinIndex;

    emit("action", {
      type: "CONNECT",
      fromBlockId: fromId,
      toBlockId: toId,
      toPinIndex: toPin,
    });
  }
  draggingPin.value = null;
};

// Utils
const getInputPinCount = (block: any) => {
  if (["AND", "OR", "NAND", "NOR", "XOR", "XNOR"].includes(block.type)) return 2;
  if (["NOT", "BUFFER", "LED"].includes(block.type)) return 1;
  if (block.type === "D_FLIP_FLOP") return 2; // D and Clock
  return 0;
};

const getConnectionPath = (conn: any) => {
  const fromBlock = props.state.blocks[conn.fromBlockId];
  const toBlock = props.state.blocks[conn.toBlockId];
  if (!fromBlock || !toBlock) return "";

  const x1 = (fromBlock.x || 100) + 80;
  const y1 = (fromBlock.y || 100) + 25;
  const x2 = toBlock.x || 100;
  const y2 = (toBlock.y || 100) + 10 + (conn.toPinIndex + 1) * 10;

  const dx = Math.abs(x1 - x2) / 2;
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
};

const getDragPath = () => {
  if (!draggingPin.value) return "";
  const x1 = draggingPin.value.x;
  const y1 = draggingPin.value.y;
  const x2 = mousePos.value.x;
  const y2 = mousePos.value.y;
  const dx = Math.abs(x1 - x2) / 2;
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
};

const isWireActive = (conn: any) => {
  return props.state.blocks[conn.fromBlockId]?.value === 1;
};

const addBlock = (gateType: string) => {
  emit("action", { type: "ADD_BLOCK", gateType, x: 100, y: 100 });
};

const removeBlock = (blockId: string) => {
  emit("action", { type: "REMOVE_BLOCK", blockId });
};

const removeConnection = (conn: any) => {
  emit("action", { type: "DISCONNECT", ...conn });
};
</script>

<style scoped>
.logic-lab-container {
  display: flex;
  flex-direction: column;
  height: 100%;
  width: 100%;
  background: #111;
  color: #eee;
  font-family: "Outfit", sans-serif;
}

.game-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem 2rem;
  background: rgba(255, 255, 255, 0.05);
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.main-layout {
  display: flex;
  flex: 1;
  overflow: hidden;
}

.toolbar {
  width: 200px;
  padding: 1rem;
  background: rgba(0, 0, 0, 0.2);
  border-right: 1px solid rgba(255, 255, 255, 0.1);
}

.gate-grid {
  display: flex;
  flex-direction: column;
}

.canvas-container {
  flex: 1;
  position: relative;
  overflow: auto;
  cursor: crosshair;
}

.logic-svg {
  display: block;
}

.block-bg {
  fill: #333;
  stroke: #555;
  stroke-width: 2;
  transition: all 0.2s;
}

.block-bg.is-active {
  stroke: #4caf50;
  box-shadow: 0 0 10px #4caf50;
}

.block-label {
  fill: #fff;
  font-size: 12px;
  font-weight: bold;
  pointer-events: none;
}

.pin {
  stroke: #555;
  stroke-width: 2;
  fill: #222;
  cursor: pointer;
  transition: all 0.2s;
}

.pin:hover {
  fill: #fff;
  r: 7;
}

.pin.output-pin.is-active {
  fill: #4caf50;
}

.connection-wire {
  stroke: #555;
  transition: stroke 0.2s;
  cursor: pointer;
}

.connection-wire:hover {
  stroke: #f44336;
}

.connection-wire.active {
  stroke: #4caf50;
  filter: drop-shadow(0 0 2px #4caf50);
}

.connection-wire.dragging {
  stroke: #aaa;
  pointer-events: none;
}

.remove-btn {
  fill: #f44336;
  opacity: 0;
  transition: opacity 0.2s;
  cursor: pointer;
}

g:hover .remove-btn {
  opacity: 1;
}

.remove-icon {
  fill: white;
  font-size: 10px;
  pointer-events: none;
  opacity: 0;
}

g:hover .remove-icon {
  opacity: 1;
}
</style>
