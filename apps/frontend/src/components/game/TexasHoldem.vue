<template>
  <div class="poker-view">
    <div class="game-header">
      <div class="phase-badge">
        {{ formatPhase(state.phase) }}
      </div>
      <div v-if="state.message" class="status-msg">
        {{ state.message }}
      </div>
    </div>

    <div class="poker-table-wrapper">
      <div class="poker-table">
        <div class="table-center">
          <div class="pot-display">
            <span class="pot-label">TOTAL POT</span>
            <span class="pot-amount">🪙 {{ state.pot }}</span>
          </div>

          <div class="community-cards">
            <div
              v-for="i in 5"
              :key="'cc-' + i"
              class="playing-card"
              :class="{ 'is-empty': !state.communityCards[i - 1] }"
            >
              <CardInner
                v-if="state.communityCards[i - 1]"
                :card-str="state.communityCards[i - 1]"
              />
            </div>
          </div>
        </div>

        <div class="opponents-container">
          <div
            v-for="opponent in opponents"
            :key="opponent.id"
            class="player-seat opponent-seat"
            :class="{
              'is-active': state.activePlayers?.includes(opponent.id),
              'is-folded': state.foldedPlayers.includes(opponent.id),
            }"
          >
            <div v-if="state.playerIds[state.dealerIndex] === opponent.id" class="dealer-button">
              D
            </div>

            <div class="seat-info">
              <div class="player-name">
                {{ opponent.id }}
              </div>
              <div class="player-chips">🪙 {{ state.playerChips[opponent.id] }}</div>
            </div>

            <div class="hole-cards opponent-cards">
              <div
                v-for="c in (state.hands[opponent.id] as any)?.value"
                :key="c"
                class="playing-card small-card"
              >
                <CardInner :card-str="c" />
              </div>
            </div>

            <div v-if="state.playerBets[opponent.id] > 0" class="current-bet">
              Bet: {{ state.playerBets[opponent.id] }}
            </div>
            <div v-if="state.foldedPlayers.includes(opponent.id)" class="action-badge folded">
              FOLD
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="my-player-area" :class="{ 'is-my-turn': isMyTurn, 'is-folded': isFolded }">
      <div class="my-seat-info">
        <div v-if="state.playerIds[state.dealerIndex] === myPlayerId" class="dealer-button">D</div>
        <div class="my-stats">
          <div class="my-name">あなた ({{ myPlayerId }})</div>
          <div class="my-chips">
            所持チップ: <strong>🪙 {{ state.playerChips[myPlayerId] }}</strong>
          </div>
          <div class="my-bet">
            現在のベット:
            <strong>{{ state.playerBets[myPlayerId] }}</strong> (コール額: {{ callAmount }})
          </div>
        </div>

        <div class="hole-cards my-cards">
          <div v-for="(c, i) in myHand" :key="'my-card-' + i" class="playing-card">
            <CardInner :card-str="c" />
          </div>
        </div>
      </div>

      <div class="action-bar">
        <div v-if="!isMyTurn" class="waiting-overlay">
          {{
            isFolded
              ? "フォールドしました。ラウンド終了を待っています..."
              : "相手のターンを待っています..."
          }}
        </div>

        <div v-else class="action-buttons">
          <button class="btn btn-fold" @click="takeAction('FOLD')">Fold</button>

          <button v-if="canCheck" class="btn btn-check" @click="takeAction('CHECK')">Check</button>
          <button v-if="canCall" class="btn btn-call" @click="takeAction('CALL')">
            Call ({{ callAmount }})
          </button>

          <div v-if="canRaise" class="raise-container">
            <input
              v-model.number="raiseAmount"
              type="range"
              :min="minRaise"
              :max="state.playerChips[myPlayerId]"
              step="10"
              class="raise-slider"
            />
            <button class="btn btn-raise" @click="takeAction('RAISE')">
              Raise ({{ raiseAmount }})
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, defineComponent, watch } from "vue";
import type { TexasHoldemState, TexasHoldemAction } from "@engine/shared/rules/TexasHoldemRuleset";

const props = defineProps<{
  state: TexasHoldemState;
  myPlayerId?: string;
}>();
const emit = defineEmits<{ (e: "action", action: TexasHoldemAction): void }>();

// --- カード描画用インラインコンポーネント ---
const CardInner = defineComponent({
  props: { cardStr: { type: String, required: true } },
  setup() {
    return () => null; // 実際の描画は以下のtemplateで
  },
  template: `
    <div class="card-inner" :class="{ 'is-red': isRed, 'is-back': isBack }">
      <div v-if="isBack" class="card-back-pattern"></div>
      <template v-else>
        <div class="top-left"><div class="rank">{{ rank }}</div><div class="suit">{{ suit }}</div></div>
        <div class="center-suit">{{ suit }}</div>
      </template>
    </div>
  `,
});

// --- プレイヤー状態の算出 ---
const myPlayerId = computed(() => {
  return props.myPlayerId || props.state.playerIds[0];
});

const isPlayer = computed(() => {
  return props.state.playerIds.includes(props.myPlayerId || "");
});

const myHand = computed(() => (props.state.hands[myPlayerId.value] as any)?.value || []);
const isMyTurn = computed(
  () => isPlayer.value && props.state.activePlayers?.includes(myPlayerId.value),
);
const isFolded = computed(() => props.state.foldedPlayers.includes(myPlayerId.value));

const opponents = computed(() => {
  return props.state.playerIds.filter((id) => id !== myPlayerId.value).map((id) => ({ id }));
});

// --- アクション制御の算出 ---
const callAmount = computed(() => {
  const target = props.state.currentBet;
  const current = props.state.playerBets[myPlayerId.value] || 0;
  return Math.max(0, target - current);
});

const canCheck = computed(() => callAmount.value === 0);
const canCall = computed(
  () => callAmount.value > 0 && props.state.playerChips[myPlayerId.value] >= callAmount.value,
);
const canRaise = computed(() => props.state.playerChips[myPlayerId.value] > callAmount.value);

// レイズ額の管理
const minRaise = computed(() =>
  Math.min(props.state.playerChips[myPlayerId.value], callAmount.value + 10),
); // 最低レイズ額の簡易計算
const raiseAmount = ref(0);

// ターンが回ってきたらレイズ額をリセット
watch(isMyTurn, (newVal) => {
  if (newVal) raiseAmount.value = minRaise.value;
});

const takeAction = (type: TexasHoldemAction["type"]) => {
  if (!isPlayer.value) return; // 観戦者ガード
  if (!isMyTurn.value) return;

  if (type === "RAISE") {
    emit("action", {
      type,
      amount: raiseAmount.value,
      playerId: myPlayerId.value,
    });
  } else {
    emit("action", { type, playerId: myPlayerId.value });
  }
};

// --- ヘルパー ---
const formatPhase = (phase: string) => {
  const map: Record<string, string> = {
    PRE_FLOP: "プリフロップ",
    FLOP: "フロップ",
    TURN: "ターン",
    RIVER: "リバー",
    SHOWDOWN: "ショーダウン",
  };
  return map[phase] || phase;
};
</script>

<style scoped>
.poker-view {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  background: radial-gradient(circle at center, #111827 0%, #000000 100%);
  color: white;
  font-family: "Inter", sans-serif;
  overflow: hidden;
}

/* --- Header --- */
.game-header {
  padding: 16px;
  text-align: center;
  z-index: 10;
}
.phase-badge {
  display: inline-block;
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.2);
  padding: 6px 16px;
  border-radius: 20px;
  font-weight: bold;
  letter-spacing: 2px;
  color: #94a3b8;
}
.status-msg {
  margin-top: 12px;
  color: #fde047;
  font-weight: bold;
}

/* --- Table Area --- */
.poker-table-wrapper {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}
.poker-table {
  width: 100%;
  max-width: 800px;
  height: 400px;
  background: #064e3b; /* カジノグリーン */
  border-radius: 200px;
  border: 16px solid #1c1917; /* テーブルの縁 */
  box-shadow:
    inset 0 0 40px rgba(0, 0, 0, 0.8),
    0 20px 40px rgba(0, 0, 0, 0.5);
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* --- Center (Pot & Community Cards) --- */
.table-center {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 20px;
}
.pot-display {
  display: flex;
  flex-direction: column;
  align-items: center;
  background: rgba(0, 0, 0, 0.5);
  padding: 8px 24px;
  border-radius: 50px;
  border: 1px solid rgba(255, 215, 0, 0.3);
}
.pot-label {
  font-size: 0.7rem;
  color: #94a3b8;
  letter-spacing: 1px;
}
.pot-amount {
  font-size: 1.5rem;
  font-weight: bold;
  color: #fbbf24;
}

.community-cards {
  display: flex;
  gap: 12px;
}
.playing-card {
  width: 60px;
  height: 84px;
  border-radius: 6px;
  box-shadow: 0 4px 8px rgba(0, 0, 0, 0.4);
}
.playing-card.is-empty {
  border: 2px dashed rgba(255, 255, 255, 0.2);
  background: rgba(0, 0, 0, 0.2);
  box-shadow: none;
}

/* --- Opponents --- */
.opponents-container {
  position: absolute;
  top: -40px;
  left: 0;
  right: 0;
  display: flex;
  justify-content: space-evenly;
  pointer-events: none;
}
.player-seat {
  background: rgba(30, 41, 59, 0.9);
  padding: 12px;
  border-radius: 12px;
  border: 2px solid transparent;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  position: relative;
  transition: all 0.3s;
}
.player-seat.is-active {
  border-color: #3b82f6;
  box-shadow: 0 0 20px rgba(59, 130, 246, 0.4);
}
.player-seat.is-folded {
  opacity: 0.5;
  filter: grayscale(1);
}

.dealer-button {
  position: absolute;
  top: -10px;
  right: -10px;
  background: white;
  color: black;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 900;
  font-size: 0.8rem;
  border: 2px solid #cbd5e1;
}

.seat-info {
  text-align: center;
}
.player-name {
  font-weight: bold;
  font-size: 0.9rem;
}
.player-chips {
  color: #fbbf24;
  font-size: 0.8rem;
}

.hole-cards {
  display: flex;
  gap: 4px;
}
.small-card {
  width: 40px;
  height: 56px;
}

.current-bet {
  background: rgba(0, 0, 0, 0.6);
  padding: 2px 10px;
  border-radius: 10px;
  font-size: 0.8rem;
  color: #6ee7b7;
}
.action-badge {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  background: #ef4444;
  color: white;
  padding: 4px 12px;
  border-radius: 4px;
  font-weight: bold;
  font-size: 1.2rem;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
}

/* --- My Area --- */
.my-player-area {
  background: rgb(var(--v-theme-surface));
  border-top: 1px solid rgba(255, 255, 255, 0.1);
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 20px;
  transition: all 0.3s;
}
.my-player-area.is-my-turn {
  box-shadow: inset 0 4px 20px rgba(59, 130, 246, 0.3);
}
.my-player-area.is-folded {
  opacity: 0.6;
}

.my-seat-info {
  display: flex;
  justify-content: space-between;
  align-items: center;
  max-width: 800px;
  margin: 0 auto;
  width: 100%;
  position: relative;
}
.my-stats {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.my-name {
  font-size: 1.2rem;
  font-weight: bold;
  color: #e2e8f0;
}
.my-chips {
  color: #fbbf24;
}
.my-bet {
  color: #94a3b8;
  font-size: 0.9rem;
}

.my-cards .playing-card {
  width: 80px;
  height: 112px;
  transform: translateY(-20px);
  box-shadow: 0 10px 20px rgba(0, 0, 0, 0.5);
}

/* --- Actions --- */
.action-bar {
  max-width: 800px;
  margin: 0 auto;
  width: 100%;
  position: relative;
  min-height: 60px;
}
.waiting-overlay {
  text-align: center;
  color: #94a3b8;
  font-style: italic;
  padding: 16px;
  background: rgba(0, 0, 0, 0.2);
  border-radius: 8px;
}
.action-buttons {
  display: flex;
  justify-content: center;
  gap: 16px;
  flex-wrap: wrap;
}
.btn {
  padding: 12px 24px;
  border-radius: 8px;
  font-weight: bold;
  border: none;
  cursor: pointer;
  font-size: 1rem;
  color: white;
  transition: all 0.2s;
}
.btn:hover {
  transform: translateY(-2px);
}
.btn-fold {
  background: #475569;
}
.btn-fold:hover {
  background: #64748b;
}
.btn-check {
  background: #10b981;
}
.btn-check:hover {
  background: #34d399;
}
.btn-call {
  background: #3b82f6;
}
.btn-call:hover {
  background: #60a5fa;
}
.btn-raise {
  background: #8b5cf6;
}
.btn-raise:hover {
  background: #a78bfa;
}

.raise-container {
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: center;
}
.raise-slider {
  width: 150px;
  cursor: pointer;
}

/* --- Card Inner CSS --- */
:deep(.card-inner) {
  width: 100%;
  height: 100%;
  background: white;
  border-radius: inherit;
  position: relative;
  padding: 4px;
  box-sizing: border-box;
  color: #1a1a1a;
}
:deep(.card-inner.is-red) {
  color: #e11d48;
}
:deep(.card-inner.is-back) {
  background: #1e3a8a;
  border: 4px solid white;
}
:deep(.card-back-pattern) {
  width: 100%;
  height: 100%;
  background-image: repeating-linear-gradient(
    45deg,
    transparent,
    transparent 4px,
    rgba(255, 255, 255, 0.2) 4px,
    rgba(255, 255, 255, 0.2) 8px
  );
}
:deep(.top-left) {
  position: absolute;
  top: 4px;
  left: 6px;
  text-align: center;
  line-height: 1;
}
:deep(.rank) {
  font-size: 1.1rem;
  font-weight: 900;
}
:deep(.suit) {
  font-size: 0.9rem;
}
:deep(.center-suit) {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  font-size: 2rem;
  opacity: 0.8;
}
</style>
