<template>
  <div class="daifugo-view">
    <div class="opponents-area">
      <div 
        v-for="opponent in opponents" 
        :key="opponent.id" 
        class="opponent-panel"
        :class="{ 
          'is-active': state.activePlayers?.includes(opponent.id),
          'has-passed': state.passedPlayers.includes(opponent.id),
          'has-won': state.ranks.includes(opponent.id)
        }"
      >
        <div class="op-avatar">👤</div>
        <div class="op-info">
          <div class="op-name">{{ opponent.id }}</div>
          <div class="op-cards">残り: {{ opponent.cardCount }}枚</div>
        </div>
        <div v-if="state.passedPlayers.includes(opponent.id)" class="badge pass">PASS</div>
        <div v-if="state.ranks.includes(opponent.id)" class="badge won">あがり</div>
      </div>
    </div>

    <div class="table-area">
      <div class="table-center">
        <div v-if="state.tableCards.length === 0" class="empty-table-msg">
          カードを出してください<br>(あなたが親です)
        </div>
        
        <div class="played-cards">
          <div 
            v-for="(card, index) in state.tableCards" 
            :key="'table-'+index" 
            class="playing-card table-card"
            :style="getCardStyle(card, index, state.tableCards.length)"
          >
            <CardFace :cardStr="card" />
          </div>
        </div>

        <div v-if="state.lastPlayedPlayerId" class="last-played-by">
          👉 出した人: {{ state.lastPlayedPlayerId }}
        </div>
      </div>
    </div>

    <div class="my-area" :class="{ 'is-my-turn': isMyTurn }">
      <div class="action-bar">
        <div class="turn-indicator" v-if="isMyTurn">🌟 あなたのターンです！</div>
        <div class="turn-indicator waiting" v-else>相手のターンを待っています...</div>

        <div class="buttons">
          <button class="btn btn-pass" @click="passTurn" :disabled="!isMyTurn">
            パス
          </button>
          <button class="btn btn-play" @click="playCards" :disabled="!canPlay">
            出す ({{ selectedCards.size }}枚)
          </button>
        </div>
      </div>

      <div class="my-hand">
        <div 
          v-for="(card, index) in myHand" 
          :key="'hand-'+card+'-'+index" 
          class="playing-card hand-card"
          :class="{ 'is-selected': selectedCards.has(card) }"
          @click="toggleCard(card)"
        >
          <CardFace :cardStr="card" />
        </div>
      </div>
    </div>

    <div v-if="state.status === 'FINISHED'" class="result-overlay">
      <div class="result-modal">
        <h2>🎉 ゲーム終了 🎉</h2>
        <div class="rank-list">
          <div v-for="(pid, index) in state.ranks" :key="pid" class="rank-item">
            <span class="rank-medal">{{ getMedal(index) }}</span>
            <span class="rank-role">{{ getRoleName(index, state.playerIds.length) }}</span>
            <span class="rank-name">{{ pid }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import type { DaifugoState, DaifugoAction, Card } from '@engine/shared/rules/DaifugoRuleset';
import CardFace from './DaifugoCardFace.vue'; // 後述のカードコンポーネント

const props = defineProps<{ state: DaifugoState }>();
const emit = defineEmits<{ (e: 'action', action: DaifugoAction): void }>();

// 自分のIDを推定（手札が "?" でマスクされていないプレイヤーを自分とする）
const myPlayerId = computed(() => {
  const ids = Object.keys(props.state.hands);
  return ids.find(id => {
    const hand = props.state.hands[id];
    return hand.length > 0 && hand[0] !== '?';
  }) || ids[0];
});

const isMyTurn = computed(() => props.state.activePlayers?.includes(myPlayerId.value));
const myHand = computed(() => props.state.hands[myPlayerId.value] || []);

// 相手プレイヤーのリスト
const opponents = computed(() => {
  return props.state.playerIds
    .filter(id => id !== myPlayerId.value)
    .map(id => ({
      id,
      cardCount: props.state.hands[id]?.length || 0
    }));
});

// カード選択ロジック
const selectedCards = ref<Set<Card>>(new Set());

const toggleCard = (card: Card) => {
  if (!isMyTurn.value) return; // 自分の番以外は触れない
  if (selectedCards.value.has(card)) {
    selectedCards.value.delete(card);
  } else {
    selectedCards.value.add(card);
  }
};

const canPlay = computed(() => isMyTurn.value && selectedCards.value.size > 0);

const playCards = () => {
  if (!canPlay.value) return;
  emit('action', { type: 'PLAY', cards: Array.from(selectedCards.value) });
  selectedCards.value.clear();
};

const passTurn = () => {
  if (!isMyTurn.value) return;
  emit('action', { type: 'PASS' });
  selectedCards.value.clear();
};

// 場のカードを少しずつズラして表示するためのスタイル計算
const getCardStyle = (card: Card, index: number, total: number) => {
  const offset = (index - (total - 1) / 2) * 20; // 1枚あたり20pxズラす
  const rotation = (Math.random() - 0.5) * 6; // ほんの少しランダムに傾ける（臨場感）
  return {
    transform: `translateX(${offset}px) rotate(${rotation}deg)`,
    zIndex: index
  };
};

// 役職名ヘルパー
const getRoleName = (rankIndex: number, totalPlayers: number) => {
  if (rankIndex === 0) return '大富豪';
  if (rankIndex === 1) return '富豪';
  if (rankIndex === totalPlayers - 1) return '大貧民';
  if (rankIndex === totalPlayers - 2 && totalPlayers >= 3) return '貧民';
  return '平民';
};

const getMedal = (index: number) => ['🥇', '🥈', '🥉', '💩'][index] || '🏅';
</script>

<style scoped>
.daifugo-view {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  background: radial-gradient(circle at center, #1e5631 0%, #0a2e13 100%); /* カジノテーブル風の緑 */
  color: white;
  overflow: hidden;
  font-family: 'Inter', sans-serif;
}

/* --- Opponents --- */
.opponents-area {
  display: flex;
  justify-content: center;
  gap: 16px;
  padding: 16px;
  background: rgba(0, 0, 0, 0.2);
}

.opponent-panel {
  display: flex;
  align-items: center;
  gap: 12px;
  background: rgba(255, 255, 255, 0.1);
  padding: 8px 16px;
  border-radius: 12px;
  position: relative;
  transition: all 0.3s;
}
.opponent-panel.is-active {
  box-shadow: 0 0 0 2px #facc15;
  background: rgba(250, 204, 21, 0.2);
}
.opponent-panel.has-passed { opacity: 0.5; }

.op-avatar { font-size: 1.5rem; }
.op-name { font-size: 0.85rem; font-weight: bold; }
.op-cards { font-size: 0.75rem; color: #cbd5e1; }

.badge {
  position: absolute;
  top: -8px;
  right: -8px;
  padding: 2px 8px;
  border-radius: 12px;
  font-size: 0.7rem;
  font-weight: bold;
}
.badge.pass { background: #64748b; }
.badge.won { background: #f59e0b; color: #fff; }

/* --- Table --- */
.table-area {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
}

.empty-table-msg {
  color: rgba(255, 255, 255, 0.4);
  text-align: center;
  font-size: 1.2rem;
  font-weight: bold;
}

.played-cards {
  position: relative;
  display: flex;
  justify-content: center;
  align-items: center;
  height: 140px;
}

.table-card {
  position: absolute;
  box-shadow: 0 8px 24px rgba(0,0,0,0.4);
}

.last-played-by {
  position: absolute;
  bottom: -30px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(0, 0, 0, 0.5);
  padding: 4px 12px;
  border-radius: 20px;
  font-size: 0.8rem;
  white-space: nowrap;
}

/* --- My Area --- */
.my-area {
  padding: 24px;
  background: linear-gradient(to top, rgba(0,0,0,0.8) 0%, transparent 100%);
  transition: transform 0.3s;
}

.action-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  max-width: 800px;
  margin: 0 auto 20px auto;
}

.turn-indicator {
  font-size: 1.1rem;
  font-weight: bold;
  color: #facc15;
}
.turn-indicator.waiting { color: #94a3b8; }

.buttons { display: flex; gap: 12px; }

.btn {
  padding: 10px 24px;
  border-radius: 8px;
  font-weight: bold;
  cursor: pointer;
  border: none;
  transition: all 0.2s;
}
.btn:disabled { opacity: 0.5; cursor: not-allowed; }
.btn-pass { background: #475569; color: white; }
.btn-pass:hover:not(:disabled) { background: #64748b; }
.btn-play { background: #3b82f6; color: white; box-shadow: 0 4px 12px rgba(59, 130, 246, 0.4); }
.btn-play:hover:not(:disabled) { background: #60a5fa; transform: translateY(-2px); }

/* --- Hand --- */
.my-hand {
  display: flex;
  justify-content: center;
  gap: -20px; /* カードを重ねるためのネガティブマージン */
  height: 120px;
  padding-top: 20px;
}

.hand-card {
  margin-left: -30px; /* カード同士を重ねる */
  transition: all 0.2s cubic-bezier(0.25, 0.8, 0.25, 1);
  cursor: pointer;
}
.hand-card:first-child { margin-left: 0; }
.hand-card:hover { transform: translateY(-15px); z-index: 100; }
.hand-card.is-selected {
  transform: translateY(-25px);
  box-shadow: 0 10px 20px rgba(0,0,0,0.5), 0 0 0 2px #3b82f6;
  z-index: 50;
}

/* --- Result Overlay --- */
.result-overlay {
  position: absolute;
  top: 0; left: 0; right: 0; bottom: 0;
  background: rgba(0, 0, 0, 0.8);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.result-modal {
  background: rgb(var(--v-theme-surface));
  padding: 32px;
  border-radius: 16px;
  text-align: center;
  border: 1px solid rgba(255,255,255,0.1);
}
.result-modal h2 { margin-bottom: 24px; color: #facc15; }
.rank-list { display: flex; flex-direction: column; gap: 12px; }
.rank-item {
  display: flex;
  align-items: center;
  gap: 16px;
  font-size: 1.2rem;
  background: rgba(255,255,255,0.05);
  padding: 12px 24px;
  border-radius: 8px;
}
.rank-role { font-weight: bold; width: 80px; text-align: left; }
</style>