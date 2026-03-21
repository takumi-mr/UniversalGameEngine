<template>
  <div class="hanafuda-container">
    <div
      v-if="isMyTurn && state.phase === 'KOIKOI_OR_STOP'"
      class="overlay"
    >
      <div class="modal">
        <div class="modal-title">
          役ができました！
        </div>
        <div class="modal-score">
          現在の文数: <span>{{ state.yakuScores[myId] }}</span>
        </div>
        <div class="modal-actions">
          <button
            class="btn-shobu"
            @click="callKoiKoi(false)"
          >
            勝負（あがり）
          </button>
          <button
            class="btn-koikoi"
            @click="callKoiKoi(true)"
          >
            こいこい（継続）
          </button>
        </div>
      </div>
    </div>

    <div
      v-if="isMyTurn && (state.phase === 'CHOOSE_HAND_MATCH' || state.phase === 'CHOOSE_DECK_MATCH')"
      class="overlay"
    >
      <div class="modal">
        <div class="modal-title">
          取る札を選んでください
        </div>
        <div class="modal-subtitle">
          場に同じ月の札が2枚あります
        </div>
        <div class="choose-options">
          <div 
            v-for="card in state.matchingOptions" 
            :key="card"
            class="card selectable"
            @click="chooseMatch(card)"
          >
            <div class="card-inner">
              {{ renderCard(card) }}
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="game-wrapper">
      <div class="player-area opponent-area">
        <div class="area-label">
          相手の獲得札 ({{ oppCaptured.length }}枚) / スコア: {{ state.yakuScores[oppId] || 0 }}
        </div>
        <div class="captured-area">
          <div
            v-for="card in oppCaptured"
            :key="`opp-cap-${card}`"
            class="card captured"
          >
            <div class="card-inner">
              {{ renderCard(card) }}
            </div>
          </div>
        </div>
        <div class="hand-area">
          <div
            v-for="(_, i) in oppHand"
            :key="`opp-hand-${i}`"
            class="card hidden"
          />
        </div>
      </div>

      <div class="center-area">
        <div class="field-area">
          <div
            v-for="card in state.field"
            :key="`field-${card}`"
            class="card field"
          >
            <div class="card-inner">
              {{ renderCard(card) }}
            </div>
          </div>
        </div>
        
        <div class="deck-area">
          <div 
            class="deck" 
            :class="{ 'is-active': isMyTurn && state.phase === 'DRAW_DECK' }"
            @click="drawDeck"
          >
            <div class="deck-text">
              山札<br>({{ state.deck.length }})
            </div>
          </div>
          <div
            v-if="isMyTurn"
            class="action-prompt"
          >
            {{ turnPromptMessage }}
          </div>
        </div>
      </div>

      <div class="player-area my-area">
        <div class="hand-area">
          <div 
            v-for="card in myHand" 
            :key="`my-hand-${card}`" 
            class="card my-hand"
            :class="{ 'is-playable': isMyTurn && state.phase === 'PLAY_HAND' }"
            @click="playCard(card)"
          >
            <div class="card-inner">
              {{ renderCard(card) }}
            </div>
          </div>
        </div>
        <div class="captured-area">
          <div
            v-for="card in myCaptured"
            :key="`my-cap-${card}`"
            class="card captured"
          >
            <div class="card-inner">
              {{ renderCard(card) }}
            </div>
          </div>
        </div>
        <div class="area-label">
          自分の獲得札 ({{ myCaptured.length }}枚) / スコア: {{ state.yakuScores[myId] || 0 }}
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { HanafudaState, HanafudaAction, Card } from '@engine/shared/rules/HanafudaRuleset';

const props = defineProps<{ 
  state: HanafudaState,
  myPlayerId?: string
}>();
const emit = defineEmits<{ (e: 'action', action: HanafudaAction): void }>();

// --- プレイヤー推論ロジック ---
const myId = computed(() => {
  return props.myPlayerId || props.state.playerIds[0];
});

const isPlayer = computed(() => {
  return props.state.playerIds.includes(props.myPlayerId || '');
});

const oppId = computed(() => {
  return props.state.playerIds.find(id => id !== myId.value) || '';
});

// --- ステートの算出 ---
const isMyTurn = computed(() => {
  return isPlayer.value && props.state.playerIds[props.state.turnIndex] === myId.value;
});

const myHand = computed(() => props.state.hands[myId.value] || []);
const oppHand = computed(() => props.state.hands[oppId.value] || []);
const myCaptured = computed(() => props.state.captured[myId.value] || []);
const oppCaptured = computed(() => props.state.captured[oppId.value] || []);

// ターンの状態に応じたプロンプトメッセージ
const turnPromptMessage = computed(() => {
  if (!isMyTurn.value) return '相手の番です';
  switch (props.state.phase) {
    case 'PLAY_HAND': return '手札から札を出してください';
    case 'DRAW_DECK': return '山札をめくってください';
    default: return '';
  }
});

// --- ヘルパー関数 ---
const renderCard = (card: Card) => {
  if (card === '?') return '';
  // "12a" -> 月:12, 種別:a
  const month = card.replace(/[a-d]/g, '');
  const type = card.replace(/[0-9]/g, '').charAt(0);
  const typeNames: Record<string, string> = { 'a': '光', 'b': 'タネ', 'c': '短', 'd': 'カス' };
  
  // 改行を入れて表示
  return `${month}月\n${typeNames[type]}`;
};

// --- アクション送信 ---
const playCard = (card: Card) => {
  if (!isPlayer.value) return; // 観戦者ガード
  if (!isMyTurn.value || props.state.phase !== 'PLAY_HAND') return;
  emit('action', { type: 'PLAY_CARD', card });
};

const drawDeck = () => {
  if (!isPlayer.value) return; // 観戦者ガード
  if (!isMyTurn.value || props.state.phase !== 'DRAW_DECK') return;
  emit('action', { type: 'DRAW_DECK' });
};

const chooseMatch = (card: Card) => {
  if (!isPlayer.value) return; // 観戦者ガード
  emit('action', { type: 'CHOOSE_MATCH', card });
};

const callKoiKoi = (isKoikoi: boolean) => {
  if (!isPlayer.value) return; // 観戦者ガード
  emit('action', { type: isKoikoi ? 'CALL_KOIKOI' : 'STOP' });
};
</script>

<style scoped>
@import url('https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;700&family=Noto+Serif+JP:wght@700&display=swap');

.hanafuda-container {
  width: 100%;
  height: 100%;
  background-color: #1e3b2e; /* 畳を意識した深い緑 */
  background-image: radial-gradient(circle at center, #274d3d 0%, #1e3b2e 100%);
  font-family: 'Outfit', 'Noto Serif JP', serif; /* 和風感を少し出す */
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 20px;
  overflow: hidden;
}

.game-wrapper {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  width: 100%;
  max-width: 900px;
  height: 100%;
  max-height: 800px;
}

/* --- エリア共通 --- */
.player-area {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.opponent-area { opacity: 0.9; }

.area-label {
  font-size: 0.85rem;
  color: #a0aec0;
  font-weight: 600;
  letter-spacing: 1px;
}

.hand-area {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: center;
  min-height: 100px;
}

.captured-area {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 10px;
  background: rgba(0, 0, 0, 0.2);
  border-radius: 8px;
  min-height: 70px;
}

.center-area {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 40px;
  flex: 1;
}

.field-area {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  justify-content: center;
  max-width: 600px;
}

/* --- 札のデザイン --- */
.card {
  width: 56px;
  height: 90px;
  background: #fdfbf7;
  border: 2px solid #2d3748;
  border-radius: 4px;
  box-shadow: 2px 3px 6px rgba(0,0,0,0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  user-select: none;
}
.card-inner {
  font-size: 0.85rem;
  font-weight: 700;
  color: #1a202c;
  text-align: center;
  white-space: pre-wrap;
  line-height: 1.2;
}

/* 相手の手札（裏向き） */
.card.hidden {
  background: #c53030; /* 和風の赤 */
  background-image: repeating-linear-gradient(45deg, transparent, transparent 5px, rgba(0,0,0,0.1) 5px, rgba(0,0,0,0.1) 10px);
  border-color: #fff;
}

/* 自分の手札 */
.card.my-hand {
  transition: transform 0.2s ease, box-shadow 0.2s ease;
}
.card.my-hand.is-playable {
  cursor: pointer;
}
.card.my-hand.is-playable:hover {
  transform: translateY(-12px);
  box-shadow: 0 10px 15px rgba(0,0,0,0.5);
  border-color: #f6e05e;
}

/* 獲得札 */
.card.captured {
  width: 40px;
  height: 64px;
}
.card.captured .card-inner {
  font-size: 0.65rem;
}

/* 山札 */
.deck-area {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
}
.deck {
  width: 64px;
  height: 104px;
  background: #2d3748;
  border: 3px dashed #718096;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #e2e8f0;
  font-weight: 700;
  transition: all 0.3s;
}
.deck-text {
  text-align: center;
  font-size: 0.85rem;
}
.deck.is-active {
  cursor: pointer;
  background: #3182ce;
  border-color: #90cdf4;
  border-style: solid;
  animation: pulse-glow 1.5s infinite;
}
.action-prompt {
  font-size: 0.9rem;
  font-weight: 600;
  color: #f6ad55;
  text-shadow: 0 2px 4px rgba(0,0,0,0.5);
}

/* --- オーバーレイ / モーダル --- */
.overlay {
  position: absolute;
  top: 0; left: 0; width: 100%; height: 100%;
  background: rgba(0, 0, 0, 0.7);
  backdrop-filter: blur(3px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 50;
}
.modal {
  background: #1a202c;
  padding: 30px 40px;
  border-radius: 12px;
  border: 1px solid rgba(255,255,255,0.1);
  box-shadow: 0 10px 30px rgba(0,0,0,0.6);
  text-align: center;
}
.modal-title {
  font-size: 1.5rem;
  color: #f6e05e;
  font-weight: 700;
  margin-bottom: 8px;
}
.modal-subtitle {
  font-size: 0.9rem;
  color: #a0aec0;
  margin-bottom: 20px;
}
.modal-score {
  font-size: 1.2rem;
  color: #e2e8f0;
  margin-bottom: 24px;
}
.modal-score span {
  font-size: 1.8rem;
  font-weight: 700;
  color: #48bb78;
}

.modal-actions {
  display: flex;
  gap: 16px;
  justify-content: center;
}
.btn-shobu, .btn-koikoi {
  font-family: inherit;
  font-size: 1.1rem;
  font-weight: 700;
  padding: 12px 24px;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  transition: transform 0.2s, filter 0.2s;
}
.btn-shobu {
  background: #e53e3e; /* 赤 */
  color: white;
}
.btn-koikoi {
  background: #3182ce; /* 青 */
  color: white;
}
.btn-shobu:hover, .btn-koikoi:hover {
  transform: translateY(-2px);
  filter: brightness(1.1);
}

/* 取る札の選択肢 */
.choose-options {
  display: flex;
  gap: 16px;
  justify-content: center;
  padding: 10px;
}
.card.selectable {
  transform: scale(1.2);
  border-color: #f6e05e;
  border-width: 3px;
  cursor: pointer;
  transition: transform 0.2s;
}
.card.selectable:hover {
  transform: scale(1.3) translateY(-5px);
  box-shadow: 0 0 15px rgba(246, 224, 94, 0.6);
}

@keyframes pulse-glow {
  0% { box-shadow: 0 0 0 0 rgba(49, 130, 206, 0.7); }
  70% { box-shadow: 0 0 0 15px rgba(49, 130, 206, 0); }
  100% { box-shadow: 0 0 0 0 rgba(49, 130, 206, 0); }
}
</style>