<template>
  <div class="mahjong-table">
    <div ref="canvasContainer" class="canvas-container" />

    <!-- 局情報 -->
    <div class="hud hud-top-left">
      <div class="round">
        {{
          $t("games.mahjong.round", {
            wind: $t(`games.mahjong.winds.${hand.wind}`),
            round: hand.round,
          })
        }}
        <span v-if="hand.honba > 0" class="sub">{{
          $t("games.mahjong.honba", { n: hand.honba })
        }}</span>
      </div>
      <div class="sub">
        {{ $t("games.mahjong.riichi_sticks", { n: hand.riichiSticks }) }} ・
        {{ $t("games.mahjong.remaining", { n: wallCount }) }}
      </div>
      <div class="sub">
        {{ $t("games.mahjong.dora") }}: {{ hand.doraIndicators.map(tileLabel).join(" ") || "-" }}
      </div>
    </div>

    <!-- 4 家の情報 -->
    <div
      v-for="seat in seats"
      :key="seat.id"
      class="seat-panel"
      :class="[`seat-${seat.position}`, { active: seat.active, me: seat.isMe }]"
    >
      <div class="seat-name">
        <span v-if="seat.dealer" class="dealer">{{ $t("games.mahjong.dealer") }}</span>
        <span class="wind">{{ $t(`games.mahjong.winds.${seat.wind}`) }}</span>
        {{ seat.id }}
      </div>
      <div class="seat-score">{{ seat.score.toLocaleString() }}</div>
      <div v-if="seat.riichi" class="riichi-badge">{{ $t("games.mahjong.riichi") }}</div>
    </div>

    <!-- 割り込み中の打牌 -->
    <div v-if="pendingPrompt" class="hud hud-center-top">
      {{ pendingPrompt }}
    </div>

    <!-- 操作ボタン -->
    <div v-if="buttons.length > 0 || riichiMode" class="actions-bar">
      <span v-if="riichiMode" class="riichi-hint">{{
        $t("games.mahjong.select_riichi_tile")
      }}</span>
      <v-btn
        v-for="button in buttons"
        :key="button.key"
        :color="button.color"
        variant="elevated"
        size="small"
        class="action-btn"
        @click="button.onClick"
      >
        {{ button.label }}
      </v-btn>
    </div>

    <!-- 局の結果 -->
    <div v-if="result" class="result-overlay">
      <div class="result-card">
        <h2>{{ resultTitle }}</h2>
        <p v-if="result.reason" class="reason">{{ result.reason }}</p>

        <div v-for="winner in result.winners" :key="winner.playerId" class="winner">
          <div class="winner-head">
            <strong>{{ winner.playerId }}</strong>
            <span>
              {{
                winner.isTsumo
                  ? $t("games.mahjong.result.tsumo")
                  : $t("games.mahjong.result.ron", { from: winner.from })
              }}
              / {{ tileLabel(winner.winTile) }}
            </span>
          </div>
          <div class="yaku-list">
            <span v-for="(han, name) in winner.yaku" :key="name" class="yaku"
              >{{ name }} {{ han }}</span
            >
          </div>
          <div class="winner-score">
            <span v-if="winner.yakuman > 0">{{ $t("games.mahjong.result.yakuman") }}</span>
            <span v-else>{{
              $t("games.mahjong.result.han_fu", { han: winner.han, fu: winner.fu })
            }}</span>
            <strong>{{
              $t("games.mahjong.result.points", { ten: winner.ten.toLocaleString() })
            }}</strong>
          </div>
        </div>

        <div v-if="result.type === 'EXHAUSTIVE_DRAW'" class="tenpai-list">
          <span
            v-for="id in hand.playerIds"
            :key="id"
            :class="result.tenpai.includes(id) ? 'tenpai' : 'noten'"
          >
            {{ id }}:
            {{
              result.tenpai.includes(id)
                ? $t("games.mahjong.result.tenpai")
                : $t("games.mahjong.result.noten")
            }}
          </span>
        </div>

        <div class="score-deltas">
          <div v-for="id in hand.playerIds" :key="id" class="delta-row">
            <span>{{ id }}</span>
            <span
              :class="{
                positive: (result.scoreDeltas[id] ?? 0) > 0,
                negative: (result.scoreDeltas[id] ?? 0) < 0,
              }"
            >
              {{ formatDelta(result.scoreDeltas[id] ?? 0) }}
            </span>
            <span class="total">{{ (hand.scores[id] ?? 0).toLocaleString() }}</span>
          </div>
        </div>

        <v-btn v-if="dismissible" color="primary" class="mt-4" @click="emit('dismiss-result')">
          {{ $t("games.mahjong.result.close") }}
        </v-btn>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import type {
  MahjongAction,
  MahjongHandResult,
  MahjongState,
  Tile,
} from "@engine/shared/rules/mahjong/MahjongRuleset";
import { MahjongUI } from "@/three/MahjongUI";
import { revealed } from "@/utils/revealed";
import { seatWindOf, tileLabel } from "@/utils/mahjong";

/**
 * 1 局分の卓（3D 描画 + 操作 UI）。1 局戦（Mahjong.vue）と対局（MahjongMatch.vue）で共有する。
 * 合法手は親コンポーネントが useGameSession から渡し、ここでは「何を出せるか」の表示と
 * クリック → アクションの変換だけを行う。
 */
const props = defineProps<{
  hand: MahjongState;
  myPlayerId?: string;
  /** 自分の合法手（対局の場合はサブアクションに展開済み） */
  legalActions: MahjongAction[];
  /** 表示する局の結果。1 局戦では state.result、対局では直前の局の結果 */
  result?: MahjongHandResult;
  /** 結果を閉じられるか（対局で次の局へ進むとき） */
  dismissible?: boolean;
}>();

const emit = defineEmits<{
  (e: "action", action: MahjongAction): void;
  (e: "dismiss-result"): void;
}>();

const { t } = useI18n();

// --- 3D ---
const canvasContainer = ref<HTMLElement | null>(null);
let threeUI: MahjongUI | null = null;

const riichiMode = ref(false);

const discardTiles = computed(() =>
  props.legalActions.filter((a) => a.type === "DISCARD").map((a) => a.tile!),
);
const riichiTiles = computed(() =>
  props.legalActions.filter((a) => a.type === "RIICHI").map((a) => a.tile!),
);
const selectableTiles = computed(() => (riichiMode.value ? riichiTiles.value : discardTiles.value));

const render = () => {
  threeUI?.renderState(props.hand, props.myPlayerId ?? "", {
    selectableTiles: selectableTiles.value,
  });
};

const onTileClick = (tile: Tile) => {
  if (riichiMode.value && riichiTiles.value.includes(tile)) {
    riichiMode.value = false;
    emit("action", { type: "RIICHI", tile, playerId: props.myPlayerId });
  } else if (discardTiles.value.includes(tile)) {
    emit("action", { type: "DISCARD", tile, playerId: props.myPlayerId });
  }
};

onMounted(() => {
  if (canvasContainer.value) {
    threeUI = new MahjongUI(canvasContainer.value, onTileClick);
    render();
  }
});

onUnmounted(() => {
  threeUI?.dispose();
  threeUI = null;
});

watch(() => [props.hand, selectableTiles.value], render, { deep: true });
// 手番が変わったら立直モードは解除する
watch(
  () => [props.hand.turnIndex, props.hand.phase],
  () => (riichiMode.value = false),
);

// --- 局情報・席 ---
const wallCount = computed(() => revealed<unknown[]>(props.hand.wall)?.length ?? 0);

const seats = computed(() => {
  const ids = props.hand.playerIds;
  const meIndex = Math.max(0, ids.indexOf(props.myPlayerId ?? ""));
  const positions = ["bottom", "right", "top", "left"] as const;
  return ids.map((id, index) => ({
    id,
    position: positions[(index - meIndex + 4) % 4]!,
    isMe: id === props.myPlayerId,
    wind: seatWindOf(props.hand, id),
    dealer: index === props.hand.dealerIndex,
    score: props.hand.scores[id] ?? 0,
    riichi: !!props.hand.riichi[id],
    active: !!props.hand.activePlayers?.includes(id),
  }));
});

const pendingPrompt = computed(() => {
  const pending = props.hand.pendingKan ?? props.hand.pendingDiscard;
  if (props.hand.phase !== "INTERRUPTING" || !pending) return "";
  return t("games.mahjong.discarded", { player: pending.playerId, tile: tileLabel(pending.tile) });
});

// --- 操作ボタン（打牌は牌クリックなのでボタンにしない） ---
interface ActionButton {
  key: string;
  label: string;
  color: string;
  onClick: () => void;
}

const buttons = computed<ActionButton[]>(() => {
  const list: ActionButton[] = [];
  const send = (action: MahjongAction) => emit("action", { ...action, playerId: props.myPlayerId });

  if (riichiMode.value) {
    list.push({
      key: "cancel",
      label: t("games.mahjong.cancel"),
      color: "grey",
      onClick: () => (riichiMode.value = false),
    });
    return list;
  }

  for (const action of props.legalActions) {
    switch (action.type) {
      case "TSUMO":
      case "RON":
        list.push({
          key: action.type,
          label: t(`games.mahjong.actions.${action.type}`),
          color: "error",
          onClick: () => send(action),
        });
        break;
      case "CALL":
        list.push({
          key: `${action.meldType}-${(action.consumed ?? []).join("")}`,
          label: `${t(`games.mahjong.actions.${action.meldType}`)} ${(action.consumed ?? []).map(tileLabel).join(" ")}`,
          color: "warning",
          onClick: () => send(action),
        });
        break;
      case "ANKAN":
      case "KAKAN":
        list.push({
          key: `${action.type}-${action.tile}`,
          label: `${t(`games.mahjong.actions.${action.type}`)} ${tileLabel(action.tile!)}`,
          color: "warning",
          onClick: () => send(action),
        });
        break;
      case "KYUUSHU_KYUUHAI":
      case "START":
        list.push({
          key: action.type,
          label: t(`games.mahjong.actions.${action.type}`),
          color: "primary",
          onClick: () => send(action),
        });
        break;
      case "PASS":
        list.push({
          key: "PASS",
          label: t("games.mahjong.actions.PASS"),
          color: "grey-lighten-1",
          onClick: () => send(action),
        });
        break;
    }
  }
  if (riichiTiles.value.length > 0) {
    list.push({
      key: "RIICHI",
      label: t("games.mahjong.actions.RIICHI"),
      color: "primary",
      onClick: () => (riichiMode.value = true),
    });
  }
  // 和了・立直 → 鳴き → その他 → パス の順に並べる
  const order = ["TSUMO", "RON", "RIICHI"];
  return list.sort((a, b) => {
    const ia = order.indexOf(a.key);
    const ib = order.indexOf(b.key);
    if (ia !== -1 || ib !== -1) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    if (a.key === "PASS") return 1;
    if (b.key === "PASS") return -1;
    return 0;
  });
});

// --- 結果 ---
const resultTitle = computed(() => {
  if (!props.result) return "";
  const key = { WIN: "win", EXHAUSTIVE_DRAW: "exhaustive_draw", ABORTIVE_DRAW: "abortive_draw" }[
    props.result.type
  ];
  return t(`games.mahjong.result.${key}`);
});

const formatDelta = (delta: number) =>
  delta > 0 ? `+${delta.toLocaleString()}` : delta.toLocaleString();
</script>

<style scoped>
.mahjong-table {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 560px;
  background: #101418;
  overflow: hidden;
}

.canvas-container {
  position: absolute;
  inset: 0;
}

.hud {
  position: absolute;
  z-index: 5;
  background: rgba(0, 0, 0, 0.65);
  color: #fff;
  padding: 8px 12px;
  border-radius: 8px;
  font-size: 0.85rem;
  pointer-events: none;
}

.hud-top-left {
  top: 12px;
  left: 12px;
}

.hud-center-top {
  top: 12px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(255, 152, 0, 0.85);
  color: #1a1a1a;
  font-weight: bold;
}

.round {
  font-size: 1.05rem;
  font-weight: bold;
}

.sub {
  opacity: 0.85;
  font-size: 0.8rem;
}

.seat-panel {
  position: absolute;
  z-index: 5;
  background: rgba(0, 0, 0, 0.6);
  color: #ddd;
  padding: 6px 10px;
  border-radius: 8px;
  border: 1px solid transparent;
  font-size: 0.8rem;
  pointer-events: none;
  min-width: 110px;
}

.seat-panel.active {
  border-color: #ffd54f;
  box-shadow: 0 0 10px rgba(255, 213, 79, 0.5);
}

.seat-panel.me {
  color: #fff;
}

.seat-bottom {
  bottom: 12px;
  left: 12px;
}

.seat-right {
  right: 12px;
  top: 50%;
  transform: translateY(-50%);
}

.seat-top {
  top: 12px;
  left: 50%;
  transform: translateX(-50%);
}

.seat-left {
  left: 12px;
  top: 50%;
  transform: translateY(-50%);
}

.seat-name {
  display: flex;
  gap: 6px;
  align-items: center;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.dealer {
  background: #e53935;
  color: #fff;
  border-radius: 4px;
  padding: 0 4px;
  font-size: 0.7rem;
}

.wind {
  background: rgba(255, 255, 255, 0.15);
  border-radius: 4px;
  padding: 0 4px;
}

.seat-score {
  font-size: 1rem;
  font-weight: bold;
}

.riichi-badge {
  display: inline-block;
  margin-top: 2px;
  background: #fff;
  color: #d32f2f;
  border-radius: 4px;
  padding: 0 6px;
  font-size: 0.7rem;
  font-weight: bold;
}

.actions-bar {
  position: absolute;
  z-index: 6;
  bottom: 16px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  align-items: center;
  gap: 8px;
  max-width: 80%;
  background: rgba(0, 0, 0, 0.55);
  padding: 8px 12px;
  border-radius: 10px;
}

.riichi-hint {
  color: #ffd54f;
  font-weight: bold;
  font-size: 0.85rem;
}

.result-overlay {
  position: absolute;
  inset: 0;
  z-index: 20;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.55);
}

.result-card {
  background: #1e1e24;
  color: #f5f5f5;
  border-radius: 12px;
  padding: 20px 28px;
  min-width: 320px;
  max-width: 90%;
  max-height: 90%;
  overflow-y: auto;
  text-align: center;
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.6);
}

.result-card h2 {
  margin: 0 0 8px;
}

.reason {
  opacity: 0.85;
}

.winner {
  margin: 12px 0;
  padding: 10px;
  background: rgba(255, 255, 255, 0.06);
  border-radius: 8px;
}

.winner-head {
  display: flex;
  justify-content: space-between;
  gap: 12px;
}

.yaku-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  justify-content: center;
  margin: 8px 0;
}

.yaku {
  background: rgba(255, 213, 79, 0.15);
  color: #ffd54f;
  border-radius: 4px;
  padding: 2px 6px;
  font-size: 0.8rem;
}

.winner-score {
  display: flex;
  justify-content: center;
  gap: 12px;
}

.tenpai-list {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  justify-content: center;
  margin: 8px 0;
  font-size: 0.85rem;
}

.tenpai {
  color: #81c784;
}

.noten {
  color: #e57373;
}

.score-deltas {
  margin-top: 10px;
  display: grid;
  gap: 4px;
}

.delta-row {
  display: grid;
  grid-template-columns: 1fr auto auto;
  gap: 16px;
  text-align: left;
}

.delta-row .total {
  opacity: 0.7;
  min-width: 60px;
  text-align: right;
}

.positive {
  color: #81c784;
}

.negative {
  color: #e57373;
}
</style>
