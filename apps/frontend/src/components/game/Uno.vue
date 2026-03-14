<template>
  <div class="uno-view">
    <div class="game-header">
      <div class="turn-info">
        <span class="turn-label">Current Turn:</span>
        <span class="turn-player" :class="{ 'is-me': isMyTurn }">
          {{ currentPlayerId }}
        </span>
      </div>
      <div class="direction-indicator">
        進行方向: {{ state.direction === 1 ? '➡️ 右回り' : '⬅️ 左回り' }}
      </div>
    </div>

    <div v-if="state.status === 'FINISHED'" class="winner-banner">
      🎉 {{ state.message }} 🎉
    </div>

    <div class="play-area">
      <div class="deck-area">
        <div class="deck-card" @click="drawCard" :class="{ 'can-click': isMyTurn }">
          <div class="uno-logo-back">UNO</div>
        </div>
        <div class="deck-count">{{ state.deck.length }}枚</div>
      </div>

      <div class="discard-area">
        <div v-if="topCard !== undefined" class="playing-card discard-card" :class="getColorClass(state.currentColor)">
          <CardFace :cardValue="getCardValue(topCard)" :color="state.currentColor" />
        </div>
        <div class="current-color-badge" :class="getColorClass(state.currentColor)">
          現在の色: {{ getColorName(state.currentColor) }}
        </div>
      </div>
    </div>

    <div class="opponents-area">
      <div v-for="opId in opponents" :key="opId" class="opponent-panel" :class="{ 'active-op': opId === currentPlayerId }">
        <div class="op-name">{{ opId }}</div>
        <div class="op-cards">残り: {{ state.hands[opId]?.length || 0 }}枚</div>
        <div v-if="state.hands[opId]?.length === 1" class="uno-call-badge">UNO!</div>
      </div>
    </div>

    <div class="my-area" :class="{ 'is-my-turn': isMyTurn }">
      <div class="my-header">
        <div class="my-name">あなた ({{ myPlayerId }})</div>
        <button class="pass-btn" v-if="isMyTurn" @click="passTurn">パス (Pass)</button>
      </div>

      <div v-if="showColorPicker" class="color-picker-overlay">
        <div class="color-picker-modal">
          <h3>色を選んでください</h3>
          <div class="color-options">
            <button class="color-btn is-red" @click="playWildCard(0)"></button>
            <button class="color-btn is-yellow" @click="playWildCard(1)"></button>
            <button class="color-btn is-green" @click="playWildCard(2)"></button>
            <button class="color-btn is-blue" @click="playWildCard(3)"></button>
          </div>
          <button class="cancel-btn" @click="cancelWildCard">キャンセル</button>
        </div>
      </div>

      <div class="my-hand">
        <div 
          v-for="(card, index) in myHand" 
          :key="card + '-' + index"
          class="playing-card hand-card"
          :class="[getColorClass(getCardColor(card)), { 'is-playable': isPlayable(card) }]"
          @click="handleCardClick(card)"
        >
          <CardFace :cardValue="getCardValue(card)" :color="getCardColor(card)" />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, defineComponent } from 'vue';
import type { UnoState, UnoAction } from '@engine/shared/rules/UnoRuleset';

const props = defineProps<{ state: UnoState }>();
const emit = defineEmits<{ (e: 'action', action: UnoAction): void }>();

// --- カードの描画用インラインコンポーネント ---
const CardFace = defineComponent({
  props: { cardValue: { type: Number, required: true }, color: { type: Number, required: true } },
  setup(props) {
    const displayStr = computed(() => {
      const v = props.cardValue;
      if (v <= 9) return v.toString();
      if (v === 10) return 'Ø'; // Skip
      if (v === 11) return '⇄'; // Reverse
      if (v === 12) return '+2';
      if (v === 13) return 'W'; // Wild
      if (v === 14) return '+4'; // Wild Draw 4
      return '?';
    });
    return () => null; // テンプレート側で処理
  },
  template: `
    <div class="card-inner">
      <div class="top-left">{{ cardValue <= 9 ? cardValue : cardValue === 10 ? 'Ø' : cardValue === 11 ? '⇄' : cardValue === 12 ? '+2' : cardValue === 13 ? 'W' : '+4' }}</div>
      <div class="center-value" :class="{ 'is-symbol': cardValue >= 10 }">
        {{ cardValue <= 9 ? cardValue : cardValue === 10 ? 'Ø' : cardValue === 11 ? '⇄' : cardValue === 12 ? '+2' : cardValue === 13 ? 'W' : '+4' }}
      </div>
      <div class="bottom-right">{{ cardValue <= 9 ? cardValue : cardValue === 10 ? 'Ø' : cardValue === 11 ? '⇄' : cardValue === 12 ? '+2' : cardValue === 13 ? 'W' : '+4' }}</div>
    </div>
  `
});

// --- ヘルパー関数群 ---
const getCardColor = (card: number) => Math.floor(card / 100);
const getCardValue = (card: number) => card % 100;

const getColorClass = (colorNum: number) => {
  if (colorNum === 0) return 'is-red';
  if (colorNum === 1) return 'is-yellow';
  if (colorNum === 2) return 'is-green';
  if (colorNum === 3) return 'is-blue';
  return 'is-wild'; // 4: Black/Wild
};

const getColorName = (colorNum: number) => {
  if (colorNum === 0) return '赤 (Red)';
  if (colorNum === 1) return '黄 (Yellow)';
  if (colorNum === 2) return '緑 (Green)';
  if (colorNum === 3) return '青 (Blue)';
  return 'ワイルド (Wild)';
};

// --- プレイヤー状態 ---
// 自分のIDを推定（手札が存在し、かつ空配列でも許容できるプレイヤー）
const myPlayerId = computed(() => {
  const ids = props.state.playerOrder;
  // TODO: 実際のネットワーク環境では props.playerId などが渡ってくるのが理想ですが、
  // ここでは先頭のプレイヤーを自分と仮定（マルチプレイ環境に合わせて適宜修正してください）
  return ids[0];
});

const myHand = computed(() => props.state.hands[myPlayerId.value] || []);
const currentPlayerId = computed(() => props.state.playerOrder[props.state.turnIndex]);
const isMyTurn = computed(() => currentPlayerId.value === myPlayerId.value);
const topCard = computed(() => props.state.discard[props.state.discard.length - 1]);

const opponents = computed(() => props.state.playerOrder.filter(id => id !== myPlayerId.value));

// --- プレイ判定 ---
const isPlayable = (card: number) => {
  if (!isMyTurn.value || topCard.value === undefined) return false;
  const cColor = getCardColor(card);
  const cValue = getCardValue(card);
  const tValue = getCardValue(topCard.value);
  
  return (
    cColor === props.state.currentColor || 
    cValue === tValue || 
    cColor === 4 // ワイルドカードはいつでも出せる
  );
};

// --- アクション ---
const pendingWildCard = ref<number | null>(null);
const showColorPicker = computed(() => pendingWildCard.value !== null);

const handleCardClick = (card: number) => {
  if (!isPlayable(card)) return;

  const color = getCardColor(card);
  if (color === 4) {
    // ワイルドカードの場合は色選択モーダルを開く
    pendingWildCard.value = card;
  } else {
    // 通常のカードはそのままプレイ
    emit('action', { type: 'PLAY', card, playerId: myPlayerId.value });
  }
};

const playWildCard = (selectedColor: number) => {
  if (pendingWildCard.value === null) return;
  emit('action', { 
    type: 'PLAY', 
    card: pendingWildCard.value, 
    color: selectedColor, 
    playerId: myPlayerId.value 
  });
  pendingWildCard.value = null;
};

const cancelWildCard = () => {
  pendingWildCard.value = null;
};

const drawCard = () => {
  if (!isMyTurn.value) return;
  emit('action', { type: 'DRAW', playerId: myPlayerId.value });
};

const passTurn = () => {
  if (!isMyTurn.value) return;
  emit('action', { type: 'PASS', playerId: myPlayerId.value });
};
</script>

<style scoped>
.uno-view {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  background: radial-gradient(circle at center, #2e1065 0%, #0f172a 100%); /* ダークパープル系 */
  color: white;
  font-family: 'Inter', 'Helvetica Neue', sans-serif;
  overflow: hidden;
}

/* --- Header --- */
.game-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 24px;
  background: rgba(0,0,0,0.3);
}
.turn-info { font-size: 1.2rem; font-weight: bold; }
.turn-label { color: #94a3b8; font-size: 0.9rem; margin-right: 8px; }
.turn-player { color: #e2e8f0; }
.turn-player.is-me { color: #fbbf24; }
.direction-indicator {
  background: rgba(255,255,255,0.1);
  padding: 6px 12px;
  border-radius: 20px;
  font-weight: bold;
}
.winner-banner {
  background: #f59e0b; color: #fff;
  text-align: center; padding: 12px;
  font-size: 1.5rem; font-weight: 900;
}

/* --- Opponents --- */
.opponents-area {
  display: flex; justify-content: center; gap: 16px; padding: 16px;
}
.opponent-panel {
  background: rgba(30, 41, 59, 0.8);
  padding: 8px 16px; border-radius: 8px;
  text-align: center; position: relative;
  border: 2px solid transparent;
}
.opponent-panel.active-op { border-color: #fbbf24; box-shadow: 0 0 12px rgba(251, 191, 36, 0.4); }
.op-name { font-weight: bold; font-size: 0.9rem; }
.op-cards { font-size: 0.8rem; color: #cbd5e1; }
.uno-call-badge {
  position: absolute; top: -10px; right: -10px;
  background: #ef4444; color: white;
  font-weight: 900; font-style: italic;
  padding: 2px 8px; border-radius: 12px;
  box-shadow: 0 2px 4px rgba(0,0,0,0.4);
  animation: pulse 1s infinite;
}
@keyframes pulse { 0% { transform: scale(1); } 50% { transform: scale(1.1); } 100% { transform: scale(1); } }

/* --- Play Area --- */
.play-area {
  flex: 1;
  display: flex; justify-content: center; align-items: center; gap: 40px;
}

.deck-area { text-align: center; }
.deck-card {
  width: 90px; height: 130px;
  background: #111;
  border: 4px solid white;
  border-radius: 8px;
  display: flex; align-items: center; justify-content: center;
  box-shadow: -4px 4px 0 #333, -8px 8px 0 #222;
  cursor: not-allowed; opacity: 0.8;
  transition: all 0.2s;
}
.deck-card.can-click { cursor: pointer; opacity: 1; border-color: #fbbf24; }
.deck-card.can-click:hover { transform: translateY(-4px); box-shadow: -4px 8px 0 #333, -8px 12px 0 #222; }
.uno-logo-back { font-size: 1.5rem; font-weight: 900; font-style: italic; color: #ef4444; text-shadow: 1px 1px 0 #fff, -1px -1px 0 #fff; transform: rotate(-15deg); }
.deck-count { margin-top: 16px; color: #cbd5e1; font-weight: bold; }

.discard-area { display: flex; flex-direction: column; align-items: center; gap: 16px; }
.discard-card { width: 100px; height: 144px; box-shadow: 0 8px 24px rgba(0,0,0,0.5); }
.current-color-badge {
  padding: 6px 16px; border-radius: 20px; font-weight: bold; font-size: 0.9rem;
  box-shadow: 0 2px 8px rgba(0,0,0,0.3);
}

/* --- My Area --- */
.my-area {
  background: rgba(15, 23, 42, 0.9);
  padding: 20px;
  border-top: 1px solid rgba(255,255,255,0.1);
  transition: background 0.3s;
}
.my-area.is-my-turn { background: rgba(30, 58, 138, 0.6); }

.my-header { display: flex; justify-content: space-between; align-items: center; max-width: 800px; margin: 0 auto 16px; }
.my-name { font-weight: bold; font-size: 1.1rem; }
.pass-btn { background: #475569; color: white; border: none; padding: 8px 20px; border-radius: 6px; font-weight: bold; cursor: pointer; }
.pass-btn:hover { background: #64748b; }

.my-hand {
  display: flex; justify-content: center; gap: 8px; flex-wrap: wrap; max-width: 900px; margin: 0 auto;
}

/* --- Cards Design --- */
.playing-card {
  width: 70px; height: 100px;
  border-radius: 6px; border: 3px solid white;
  box-sizing: border-box; position: relative;
  user-select: none; transition: transform 0.2s;
}
.hand-card { opacity: 0.6; cursor: not-allowed; }
.hand-card.is-playable { opacity: 1; cursor: pointer; box-shadow: 0 4px 8px rgba(0,0,0,0.3); }
.hand-card.is-playable:hover { transform: translateY(-10px); }

/* UNO Colors */
.is-red { background: #ef4444; color: white; }
.is-yellow { background: #eab308; color: white; }
.is-green { background: #22c55e; color: white; }
.is-blue { background: #3b82f6; color: white; }
.is-wild { background: #171717; color: white; }

/* Card Inner Component Styles */
:deep(.card-inner) {
  width: 100%; height: 100%; position: relative;
  display: flex; align-items: center; justify-content: center;
}
:deep(.top-left), :deep(.bottom-right) {
  position: absolute; font-weight: 900; font-size: 1rem; line-height: 1; text-shadow: 1px 1px 0 rgba(0,0,0,0.3);
}
:deep(.top-left) { top: 4px; left: 6px; }
:deep(.bottom-right) { bottom: 4px; right: 6px; transform: rotate(180deg); }
:deep(.center-value) {
  background: white; color: inherit; /* 外側の色が継承される仕掛け（CSSの都合上、親の背景色に合わせる場合は工夫が必要ですが、ここでは白地に文字色というシンプルなデザインにします） */
  width: 70%; height: 70%; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  font-weight: 900; font-size: 2.2rem; font-style: italic;
  box-shadow: inset 0 2px 4px rgba(0,0,0,0.2);
  color: #333; /* 文字は黒系に固定 */
}
:deep(.center-value.is-symbol) { font-size: 1.6rem; }

/* --- Color Picker Modal --- */
.color-picker-overlay {
  position: fixed; top: 0; left: 0; right: 0; bottom: 0;
  background: rgba(0,0,0,0.8); display: flex; align-items: center; justify-content: center; z-index: 100;
}
.color-picker-modal {
  background: #1e293b; padding: 24px; border-radius: 12px; text-align: center;
}
.color-options { display: flex; gap: 16px; margin: 20px 0; }
.color-btn {
  width: 60px; height: 60px; border-radius: 50%; border: 4px solid white; cursor: pointer; transition: transform 0.2s;
}
.color-btn:hover { transform: scale(1.1); }
.cancel-btn { background: #475569; color: white; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer; }
</style>