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

          <div v-if="Object.keys(customBlocks).length" class="text-overline mt-4 mb-2">Custom</div>
          <div class="gate-grid">
            <v-btn
              v-for="(custom, levelId) in customBlocks"
              :key="levelId"
              size="small"
              variant="tonal"
              color="secondary"
              class="mb-2"
              @click="addCustomBlock(Number(levelId))"
            >
              {{ custom.name }}
            </v-btn>
          </div>
        </v-card>

        <v-card variant="outlined" class="pa-2 mt-4">
          <div class="text-overline mb-2">Sim Controls</div>
          <v-btn block size="small" color="secondary" class="mb-2" @click="pulseClock">
            Pulse Clock
          </v-btn>
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
              :height="
                Math.max(
                  50,
                  (Math.max(getInputPinCount(block), getOutputPinCount(block)) || 1) * 20,
                )
              "
              rx="8"
              class="block-bg"
              :class="{
                'is-active': block.outputs?.[0] === 1,
                'is-selected': selectedBlock?.id === block.id,
              }"
              @click="onBlockClick(block)"
            />
            <text x="40" y="25" text-anchor="middle" class="block-label">{{ block.type }}</text>

            <!-- RAM Memory Mini-indicator -->
            <text
              v-if="block.type === 'RAM'"
              x="40"
              y="45"
              text-anchor="middle"
              class="block-subtext"
            >
              [RAM]
            </text>

            <!-- Input Pins -->
            <circle
              v-for="i in getInputPinCount(block)"
              :key="'in-' + i"
              cx="0"
              :cy="getPinY(block, i - 1, getInputPinCount(block))"
              r="5"
              class="pin input-pin"
              @mouseup.stop="onPinMouseUp(block.id, i - 1, 'in')"
            />

            <!-- Output Pins -->
            <circle
              v-for="i in getOutputPinCount(block)"
              :key="'out-' + i"
              cx="80"
              :cy="getPinY(block, i - 1, getOutputPinCount(block))"
              r="5"
              class="pin output-pin"
              :class="{ 'is-active': block.outputs?.[i - 1] === 1 }"
              @mousedown.stop="onPinMouseDown(block.id, i - 1, 'out')"
            />

            <!-- Remove Button -->
            <circle cx="75" cy="5" r="8" class="remove-btn" @click.stop="removeBlock(block.id)" />
            <text x="75" y="8" text-anchor="middle" class="remove-icon">×</text>
          </g>
        </svg>
      </div>
    </div>

    <!-- ROM Editor Dialog -->
    <v-dialog v-model="romEditorOpen" max-width="600px">
      <v-card>
        <v-card-title class="d-flex justify-space-between align-center">
          <span>ROM DATA EDITOR (16 x 8-bit)</span>
          <v-btn icon="mdi-close" variant="text" @click="romEditorOpen = false"></v-btn>
        </v-card-title>
        <v-card-text>
          <div class="rom-data-grid">
            <div v-for="i in 16" :key="i" class="rom-cell">
              <span class="text-caption">0x{{ (i - 1).toString(16).toUpperCase() }}</span>
              <v-text-field
                v-model.number="romDataArray[i - 1]"
                type="number"
                min="0"
                max="255"
                density="compact"
                hide-details
                variant="outlined"
              ></v-text-field>
            </div>
          </div>
        </v-card-text>
        <v-card-actions>
          <v-spacer></v-spacer>
          <v-btn color="primary" @click="saveRomData">Apply Data</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
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
const canvasWidth = ref(1500);
const canvasHeight = ref(1000);

const selectedBlock = ref<any>(null);
const romEditorOpen = ref(false);
const romDataArray = ref<number[]>(new Array(16).fill(0));

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

const customBlocks = computed(() => {
  if ("customBlocks" in props.state) {
    return (props.state as LogicLabState).customBlocks;
  }
  return {};
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
  const x = (block.x || 100) + (type === "out" ? 80 : 0);
  const y =
    (block.y || 100) +
    getPinY(block, pinIndex, type === "in" ? getInputPinCount(block) : getOutputPinCount(block));

  draggingPin.value = {
    blockId,
    pinIndex,
    type,
    x,
    y,
  };
};

const onPinMouseUp = (blockId: string, pinIndex: number, type: "in" | "out") => {
  if (draggingPin.value && draggingPin.value.type !== type) {
    const fromId = type === "out" ? blockId : draggingPin.value.blockId;
    const fromPin = type === "out" ? pinIndex : draggingPin.value.pinIndex;
    const toId = type === "in" ? blockId : draggingPin.value.blockId;
    const toPin = type === "in" ? pinIndex : draggingPin.value.pinIndex;

    emit("action", {
      type: "CONNECT",
      fromBlockId: fromId,
      fromPinIndex: fromPin,
      toBlockId: toId,
      toPinIndex: toPin,
    });
  }
  draggingPin.value = null;
};

const onBlockClick = (block: any) => {
  selectedBlock.value = block;
  if (block.type === "SWITCH") {
    emit("action", { type: "TOGGLE_SWITCH", blockId: block.id });
  } else if (block.type === "ROM") {
    romDataArray.value = block.romData ? [...block.romData] : new Array(16).fill(0);
    romEditorOpen.value = true;
  }
};

const pulseClock = () => {
  Object.values(props.state.blocks).forEach((block) => {
    if (
      block.type === "SWITCH" &&
      (block.id.toLowerCase().includes("clock") || block.id.toLowerCase().includes("clk"))
    ) {
      emit("action", { type: "TOGGLE_SWITCH", blockId: block.id });
    }
  });
};

const saveRomData = () => {
  if (selectedBlock.value && selectedBlock.value.type === "ROM") {
    emit("action", {
      type: "ROM_SET_DATA",
      blockId: selectedBlock.value.id,
      data: [...romDataArray.value],
    });
    romEditorOpen.value = false;
  }
};

// Utils
const getInputPinCount = (block: any) => {
  if (block.compound) {
    return Object.keys(block.compound.blocks).filter((id) => id.startsWith("in")).length;
  }
  if (block.type === "ROM") return 4;
  if (block.type === "RAM") return 10;
  if (block.type === "1-bit ALU") return 5;
  if (block.type === "Full Adder") return 3;
  if (["AND", "OR", "NAND", "NOR", "XOR", "XNOR"].includes(block.type)) return 2;
  if (["NOT", "BUFFER", "LED", "D_FLIP_FLOP"].includes(block.type)) return 1;
  if (block.type === "D_FLIP_FLOP") return 2;
  return 0;
};

const getOutputPinCount = (block: any) => {
  if (block.compound) {
    return Object.keys(block.compound.blocks).filter((id) => id.startsWith("out")).length;
  }
  if (block.type === "ROM") return 8;
  if (block.type === "RAM") return 4;
  if (block.type === "1-bit ALU") return 2;
  if (block.type === "Full Adder") return 2;
  if (block.type === "Half Adder") return 2;
  if (block.type === "SWITCH") return 1;
  return 1;
};

const getPinY = (block: any, index: number, total: number) => {
  const height = Math.max(
    50,
    (Math.max(getInputPinCount(block), getOutputPinCount(block)) || 1) * 20,
  );
  if (total <= 1) return height / 2;
  const spacing = (height - 20) / (total - 1);
  return 10 + index * spacing;
};

const getConnectionPath = (conn: any) => {
  const fromBlock = props.state.blocks[conn.fromBlockId];
  const toBlock = props.state.blocks[conn.toBlockId];
  if (!fromBlock || !toBlock) return "";

  const x1 = (fromBlock.x || 100) + 80;
  const y1 =
    (fromBlock.y || 100) + getPinY(fromBlock, conn.fromPinIndex, getOutputPinCount(fromBlock));
  const x2 = toBlock.x || 100;
  const y2 = (toBlock.y || 100) + getPinY(toBlock, conn.toPinIndex, getInputPinCount(toBlock));

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
  return props.state.blocks[conn.fromBlockId]?.outputs?.[conn.fromPinIndex] === 1;
};

const addBlock = (gateType: string) => {
  const rect = canvasContainer.value?.getBoundingClientRect();
  const x = rect ? (canvasContainer.value?.scrollLeft || 0) + 200 : 200;
  const y = rect ? (canvasContainer.value?.scrollTop || 0) + 200 : 200;
  emit("action", { type: "ADD_BLOCK", gateType, x, y });
};

const addCustomBlock = (levelId: number) => {
  emit("action", { type: "ADD_CUSTOM_BLOCK", levelId, x: 200, y: 200 });
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
  width: 220px;
  padding: 1rem;
  background: rgba(0, 0, 0, 0.2);
  border-right: 1px solid rgba(255, 255, 255, 0.1);
  overflow-y: auto;
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
  fill: #2a2a2a;
  stroke: #444;
  stroke-width: 2;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}

.block-bg:hover {
  stroke: #666;
  fill: #333;
}

.block-bg.is-selected {
  stroke: #2196f3;
  stroke-width: 3;
}

.block-bg.is-active {
  stroke: #00e676;
  filter: drop-shadow(0 0 8px rgba(0, 230, 118, 0.4));
}

.block-label {
  fill: #fff;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  pointer-events: none;
}

.block-subtext {
  fill: rgba(255, 255, 255, 0.5);
  font-size: 8px;
  pointer-events: none;
}

.pin {
  stroke: #444;
  stroke-width: 1.5;
  fill: #1a1a1a;
  cursor: pointer;
  transition: all 0.2s;
}

.pin:hover {
  fill: #fff;
  r: 6;
  stroke: #2196f3;
}

.pin.output-pin.is-active {
  fill: #00e676;
  stroke: #00e676;
  filter: drop-shadow(0 0 4px #00e676);
}

.connection-wire {
  stroke: #444;
  stroke-linecap: round;
  transition: stroke 0.2s;
  cursor: pointer;
}

.connection-wire:hover {
  stroke: #ff5252;
  stroke-width: 4;
}

.connection-wire.active {
  stroke: #00e676;
  filter: drop-shadow(0 0 3px #00e676);
  stroke-width: 4;
}

.connection-wire.dragging {
  stroke: #2196f3;
  opacity: 0.6;
  pointer-events: none;
}

.remove-btn {
  fill: #ff5252;
  opacity: 0;
  transition: opacity 0.2s;
  cursor: pointer;
}

g:hover .remove-btn {
  opacity: 0.8;
}

.remove-btn:hover {
  opacity: 1;
}

.remove-icon {
  fill: white;
  font-size: 12px;
  font-weight: bold;
  pointer-events: none;
  opacity: 0;
}

g:hover .remove-icon {
  opacity: 1;
}

.rom-data-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
  padding: 12px 0;
}

.rom-cell {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.test-item {
  display: flex;
  align-items: center;
  font-size: 0.8rem;
  margin-bottom: 4px;
}
</style>
