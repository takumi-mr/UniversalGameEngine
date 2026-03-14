<template>
  <div class="highlow-view">
    <div class="header-board">
      <div class="round-badge">Round {{ state.round }}</div>
      <div class="status-msg" :class="{ 'is-finished': state.status === 'FINISHED' }">
        {{ state.message }}
      </div>
    </div>

    <div class="table-area">
      <div class="player-zone player2-zone" :class="{ 'active-turn': state.currentTurn === 2 }">
        <div class="player-info">
          <div class="avatar">👤</div>
          <div class="name">Player 2 {{ state.players?.['2'] ? `(${state.players['2']})` : '' }}</div>
          <div class="score">Score: <span>{{ state.scores[2] }}</span></div>
        </div>
        <div class="card-slot">
          <div v-if="state.field[2]" class="playing-card face-up">
            <CardInner :card="state.field[2]" />
          </div>
          <div v-else class="playing-card empty-slot"></div>
        </div>
        <button 
          v-if="state.status === 'PLAYING'"
          class="draw-btn" 
          :disabled="state.currentTurn !== 2"
          @click="drawCard(2)"
        >
          {{ state.currentTurn === 2 ? '引く (Draw)' : '待機中...' }}
        </button>
      </div>

      <div class="center-zone">
        <div class="deck-container">
          <div class="deck-count">残り: {{ state.deck.length }}枚</div>
          <div class="deck-visual" :class="{ 'is-empty': state.deck.length === 0 }">
            <div v-if="state.deck.length > 0" class="card-back"></div>
            <div v-else class="deck-empty-text">Empty</div>
          </div>
        </div>
        <div class="vs-badge">VS</div>
      </div>

      <div class="player-zone player1-zone" :class="{ 'active-turn': state.currentTurn === 1 }">
        <button 
          v-if="state.status === 'PLAYING'"
          class="draw-btn" 
          :disabled="state.currentTurn !== 1"
          @click="drawCard(1)"
        >
          {{ state.currentTurn === 1 ? '引く (Draw)' : '待機中...' }}
        </button>
        <div class="card-slot">
          <div v-if="state.field[1]" class="playing-card face-up">
            <CardInner :card="state.field[1]" />
          </div>
          <div v-else class="playing-card empty-slot"></div>
        </div>
        <div class="player-info">
          <div class="name">Player 1 {{ state.players?.['1'] ? `(${state.players['1']})` : '' }}</div>
          <div class="score">Score: <span>{{ state.scores[1] }}</span></div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { defineComponent } from 'vue';
import type { HighLowState, DrawAction, Card } from '@engine/shared/rules/HighLowRuleset';

const props = defineProps<{ state: HighLowState }>();
const emit = defineEmits<{ (e: 'action', action: DrawAction): void }>();

// カード描画用の軽量インラインコンポーネント（HighLow特有のデータ構造に対応）
const CardInner = defineComponent({
  props: { card: { type: Object as () => Card, required: true } },
  setup(props) {
    const displayRank = (rank: number) => {
      if (rank === 1) return 'A';
      if (rank === 11) return 'J';
      if (rank === 12) return 'Q';
      if (rank === 13) return 'K';
      return rank.toString();
    };
    const isRed = props.card.suit === '♥' || props.card.suit === '♦';
    
    return () => {
      // JSXライクなレンダー関数（Vue 3）は使わず、シンプルなHTML文字列やクラス判定に回します
      // ここでは template 内で使える computed プロパティとして提供
      return null; 
    };
  },
  template: `
    <div class="card-inner" :class="{ 'is-red': card.suit === '♥' || card.suit === '♦' }">
      <div class="top-left">
        <div class="rank">{{ card.rank === 1 ? 'A' : card.rank === 11 ? 'J' : card.rank === 12 ? 'Q' : card.rank === 13 ? 'K' : card.rank }}</div>
        <div class="suit">{{ card.suit }}</div>
      </div>
      <div class="center-suit">{{ card.suit }}</div>
    </div>
  `
});

// カードを引くアクション
const drawCard = (playerNumber: 1 | 2) => {
  if (props.state.status !== 'PLAYING') return;
  if (props.state.currentTurn !== playerNumber) return;

  emit('action', { type: 'DRAW', player: playerNumber });
};
</script>

<style scoped>
.highlow-view {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 100%;
  height: 100%;
  background: radial-gradient(circle at center, #1e3a8a 0%, #0f172a 100%); /* ネイビーのカジノ風 */
  color: white;
  font-family: 'Inter', sans-serif;
  padding: 24px;
  box-sizing: border-box;
}

/* --- Header / Message --- */
.header-board {
  text-align: center;
  margin-bottom: 24px;
  width: 100%;
  max-width: 600px;
}

.round-badge {
  display: inline-block;
  background: rgba(255, 255, 255, 0.1);
  padding: 6px 16px;
  border-radius: 20px;
  font-weight: 600;
  letter-spacing: 1px;
  margin-bottom: 12px;
  border: 1px solid rgba(255, 255, 255, 0.2);
}

.status-msg {
  background: rgba(16, 185, 129, 0.2);
  border: 1px solid rgba(16, 185, 129, 0.4);
  color: #a7f3d0;
  padding: 16px;
  border-radius: 12px;
  font-size: 1.1rem;
  font-weight: bold;
  box-shadow: 0 4px 12px rgba(0,0,0,0.2);
}
.status-msg.is-finished {
  background: rgba(245, 158, 11, 0.2);
  border-color: rgba(245, 158, 11, 0.4);
  color: #fde68a;
  font-size: 1.3rem;
}

/* --- Table Area --- */
.table-area {
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  width: 100%;
  max-width: 600px;
  background: rgba(255, 255, 255, 0.03);
  border-radius: 24px;
  border: 1px solid rgba(255, 255, 255, 0.05);
  padding: 32px;
  position: relative;
}

/* --- Player Zones --- */
.player-zone {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  transition: all 0.3s;
  padding: 16px;
  border-radius: 16px;
}
.player-zone.active-turn {
  background: rgba(59, 130, 246, 0.1);
  box-shadow: 0 0 20px rgba(59, 130, 246, 0.2);
}

.player-info {
  text-align: center;
}
.player-info .name { font-weight: bold; font-size: 1.1rem; color: #e2e8f0; }
.player-info .score { font-size: 0.9rem; color: #94a3b8; margin-top: 4px; }
.player-info .score span { font-size: 1.2rem; font-weight: bold; color: #facc15; }

.draw-btn {
  background: #3b82f6;
  color: white;
  border: none;
  padding: 12px 32px;
  border-radius: 50px;
  font-size: 1rem;
  font-weight: bold;
  cursor: pointer;
  transition: all 0.2s;
  box-shadow: 0 4px 12px rgba(59, 130, 246, 0.4);
}
.draw-btn:hover:not(:disabled) { transform: translateY(-2px); background: #60a5fa; }
.draw-btn:disabled { background: #475569; color: #94a3b8; box-shadow: none; cursor: not-allowed; }

/* --- Cards & Slots --- */
.card-slot {
  width: 100px;
  height: 140px;
}

.playing-card {
  width: 100%;
  height: 100%;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.empty-slot {
  border: 2px dashed rgba(255, 255, 255, 0.2);
  background: rgba(0, 0, 0, 0.2);
}

.face-up {
  background: white;
  box-shadow: 0 4px 12px rgba(0,0,0,0.3);
  color: black;
  animation: flipIn 0.4s ease-out forwards;
}

@keyframes flipIn {
  0% { transform: rotateY(90deg) scale(0.9); opacity: 0; }
  100% { transform: rotateY(0deg) scale(1); opacity: 1; }
}

/* Card Inner Styling */
:deep(.card-inner) {
  width: 100%; height: 100%;
  position: relative; padding: 6px; box-sizing: border-box;
}
:deep(.card-inner.is-red) { color: #e11d48; }
:deep(.top-left) { position: absolute; top: 6px; left: 8px; text-align: center; line-height: 1.1;}
:deep(.top-left .rank) { font-size: 1.2rem; font-weight: bold; }
:deep(.top-left .suit) { font-size: 1rem; }
:deep(.center-suit) { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); font-size: 3rem; opacity: 0.8; }

/* --- Center Zone --- */
.center-zone {
  display: flex;
  align-items: center;
  justify-content: center;
  position: absolute;
  top: 50%; left: 50%;
  transform: translate(-50%, -50%);
  gap: 32px;
}

.vs-badge {
  background: #ef4444;
  color: white;
  font-weight: 900;
  font-style: italic;
  padding: 8px 12px;
  border-radius: 50%;
  font-size: 1.2rem;
  box-shadow: 0 4px 12px rgba(239, 68, 68, 0.5);
  z-index: 10;
}

.deck-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.deck-count {
  font-size: 0.8rem;
  color: #cbd5e1;
  background: rgba(0,0,0,0.5);
  padding: 2px 8px;
  border-radius: 10px;
}

.deck-visual {
  width: 80px;
  height: 112px;
  border-radius: 6px;
  box-shadow: 
    -2px -2px 0 #fff, -4px -4px 0 #cbd5e1, 
    -6px -6px 0 #fff, -8px -8px 0 #94a3b8;
  background-image: repeating-linear-gradient(45deg, #1e3a8a, #1e3a8a 5px, #2563eb 5px, #2563eb 10px);
  border: 2px solid white;
}
.deck-visual.is-empty {
  background: rgba(0,0,0,0.2);
  border: 2px dashed rgba(255,255,255,0.2);
  box-shadow: none;
  display: flex;
  align-items: center;
  justify-content: center;
}
.deck-empty-text { font-size: 0.9rem; color: #64748b; font-weight: bold; }
</style>