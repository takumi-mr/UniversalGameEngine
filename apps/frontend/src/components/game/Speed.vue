<template>
  <div class="speed-view">
    <!-- Game Status / Results -->
    <div
      v-if="state.status === 'FINISHED'"
      class="game-overlay"
    >
      <div class="result-box">
        <h2>{{ state.message }}</h2>
        <button
          class="restart-btn"
          @click="startNewGame"
        >
          New Game
        </button>
      </div>
    </div>

    <!-- Opponent Area -->
    <div class="player-area opponent">
      <div class="player-info">
        <span class="name">{{ opponentId || 'Waiting...' }}</span>
        <span class="deck-count">Deck: {{ opponentDeckCount }}</span>
      </div>
      <div class="cards-display">
        <div
          v-for="i in opponentHandCount"
          :key="'op-hand-'+i"
          class="card back mini"
        />
      </div>
    </div>

    <!-- Center Area -->
    <div class="center-area">
      <!-- Side Piles (Used when stuck) -->
      <div class="side-pile-group">
        <div
          v-if="state.sidePiles[0]?.length > 0"
          class="card back mini pile-shadow"
        >
          <span class="count">{{ state.sidePiles[0].length }}</span>
        </div>
        <div
          v-else
          class="empty-slot mini"
        />
      </div>

      <!-- Active Piles -->
      <div class="active-piles">
        <div
          v-for="(card, idx) in state.centerPiles"
          :key="'pile-'+idx" 
          class="card active-pile" 
          :class="getCardColorClass(card)"
          @click="playCardToPile(idx)"
        >
          <div class="card-content">
            <span class="rank">{{ getRank(card) }}</span>
            <span class="suit">{{ getSuitEmoji(card) }}</span>
          </div>
        </div>
      </div>

      <div class="side-pile-group">
        <div
          v-if="state.sidePiles[1]?.length > 0"
          class="card back mini pile-shadow"
        >
          <span class="count">{{ state.sidePiles[1].length }}</span>
        </div>
        <div
          v-else
          class="empty-slot mini"
        />
      </div>
    </div>

    <!-- Actions Area -->
    <div class="actions-area">
      <button
        v-if="state.status === 'WAITING' && isHost"
        class="action-btn start"
        @click="startGame"
      >
        Start Game
      </button>
      <button
        v-if="state.status === 'PLAYING'" 
        class="action-btn flip" 
        :class="{ 'is-stuck': isStuck }" 
        @click="toggleStuck"
      >
        {{ isStuck ? 'Stuck (Waiting...)' : 'I am Stuck' }}
      </button>
    </div>

    <!-- Player Area -->
    <div
      class="player-area self"
      :class="{ 'my-turn': true }"
    >
      <div class="cards-display">
        <div
          v-for="(card, index) in myHand"
          :key="'my-hand-'+index" 
          class="card playable" 
          :class="[getCardColorClass(card), { 'selected': selectedHandIndex === index }]"
          @click="selectCard(index)"
        >
          <div class="card-content">
            <span class="rank">{{ getRank(card) }}</span>
            <span class="suit">{{ getSuitEmoji(card) }}</span>
          </div>
        </div>
      </div>
      <div class="player-info">
        <div class="deck-display">
          <div
            v-if="myDeckCount > 0"
            class="card back mini"
          />
          <span class="deck-count">Your Deck: {{ myDeckCount }}</span>
        </div>
        <span class="name">You ({{ myPlayerId }})</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import type { SpeedState, SpeedAction, Card } from '@engine/shared/rules/SpeedRuleset';

const props = defineProps<{
  state: SpeedState;
  myPlayerId?: string;
}>();

const emit = defineEmits<{
  (e: 'action', action: SpeedAction): void;
}>();

const selectedHandIndex = ref<number | null>(null);

// --- State Helpers ---
const myPlayerId = computed(() => props.myPlayerId || '');
const _isPlayer = computed(() => props.state.playerIds.includes(myPlayerId.value));
const isHost = computed(() => props.state.playerIds[0] === myPlayerId.value);

const opponentId = computed(() => props.state.playerIds.find(id => id !== myPlayerId.value));

const myHand = computed(() => props.state.hands[myPlayerId.value] || []);
const myDeckCount = computed(() => props.state.personalDecks[myPlayerId.value]?.length || 0);

const opponentHandCount = computed(() => {
  if (!opponentId.value) return 0;
  return props.state.hands[opponentId.value]?.length || 0;
});
const opponentDeckCount = computed(() => {
  if (!opponentId.value) return 0;
  return props.state.personalDecks[opponentId.value]?.length || 0;
});

const isStuck = computed(() => props.state.isStuck[myPlayerId.value] || false);

// --- Utility Functions ---
function getRank(card: Card): string {
  if (!card || card === '?') return '';
  return card.charAt(0) === 'T' ? '10' : card.charAt(0);
}

function getSuitEmoji(card: Card): string {
  if (!card || card === '?') return '';
  const suit = card.charAt(1);
  if (suit === 'S') return '♠';
  if (suit === 'H') return '♥';
  if (suit === 'D') return '♦';
  if (suit === 'C') return '♣';
  return '';
}

function getCardColorClass(card: Card): string {
  if (!card || card === '?') return '';
  const suit = card.charAt(1);
  return (suit === 'H' || suit === 'D') ? 'red' : 'black';
}

// --- Actions ---
function startGame() {
  emit('action', { type: 'START', playerId: myPlayerId.value });
}

function selectCard(index: number) {
  if (selectedHandIndex.value === index) {
    selectedHandIndex.value = null;
  } else {
    selectedHandIndex.value = index;
  }
}

function playCardToPile(pileIndex: number) {
  if (selectedHandIndex.value === null) return;
  const card = myHand.value[selectedHandIndex.value];
  
  emit('action', { 
    type: 'PLAY', 
    card, 
    pileIndex, 
    playerId: myPlayerId.value 
  });
  
  selectedHandIndex.value = null;
}

function toggleStuck() {
  emit('action', { type: 'FLIP', playerId: myPlayerId.value });
}

function startNewGame() {
    // In many of these engines, START works to reset or the room owner does it
    if (isHost.value) {
        emit('action', { type: 'START', playerId: myPlayerId.value });
    }
}
</script>

<style scoped>
.speed-view {
  width: 100%;
  height: 600px;
  background: radial-gradient(circle, #2c3e50 0%, #000 100%);
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  padding: 20px;
  color: white;
  font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
  position: relative;
  border-radius: 12px;
  overflow: hidden;
}

.game-overlay {
  position: absolute;
  top: 0; left: 0; right: 0; bottom: 0;
  background: rgba(0,0,0,0.8);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 100;
}

.result-box {
  background: #fff;
  color: #333;
  padding: 30px;
  border-radius: 12px;
  text-align: center;
  box-shadow: 0 0 30px rgba(255,255,255,0.2);
}

.restart-btn {
  margin-top: 20px;
  padding: 10px 24px;
  background: #e74c3c;
  color: white;
  border: none;
  border-radius: 6px;
  font-weight: bold;
  cursor: pointer;
}

.player-area {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
}

.player-info {
  display: flex;
  align-items: center;
  gap: 20px;
  background: rgba(255,255,255,0.1);
  padding: 5px 15px;
  border-radius: 20px;
}

.cards-display {
  display: flex;
  gap: 10px;
  height: 120px;
  align-items: flex-end;
}

.center-area {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 30px;
}

.active-piles {
  display: flex;
  gap: 15px;
}

.actions-area {
  display: flex;
  justify-content: center;
  gap: 20px;
}

.action-btn {
  padding: 12px 24px;
  font-size: 1.1rem;
  font-weight: bold;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;
}

.action-btn.start { background: #27ae60; color: white; }
.action-btn.flip { background: #f39c12; color: white; }
.action-btn.flip.is-stuck { background: #7f8c8d; opacity: 0.7; }

/* Card Styles */
.card {
  width: 80px;
  height: 120px;
  background: #fff;
  border-radius: 8px;
  display: flex;
  justify-content: center;
  align-items: center;
  color: #333;
  box-shadow: 0 4px 8px rgba(0,0,0,0.3);
  position: relative;
  user-select: none;
  transition: all 0.2s;
}

.card.mini {
  width: 60px;
  height: 90px;
}

.card.back {
  background: #c0392b;
  border: 4px solid #fff;
  background-image: repeating-linear-gradient(45deg, transparent, transparent 10px, rgba(255,255,255,0.1) 10px, rgba(255,255,255,0.1) 20px);
}

.card.playable {
  cursor: pointer;
}

.card.playable:hover {
  transform: translateY(-10px);
  box-shadow: 0 10px 20px rgba(0,0,0,0.4);
}

.card.selected {
  transform: translateY(-20px);
  border: 3px solid #f1c40f;
  box-shadow: 0 0 15px #f1c40f;
}

.card.active-pile {
  border: 2px solid #fff;
  cursor: pointer;
}

.card.active-pile:hover {
  box-shadow: 0 0 15px #fff;
}

.card-content {
  display: flex;
  flex-direction: column;
  align-items: center;
}

.rank {
  font-size: 1.8rem;
  font-weight: 900;
}

.suit {
  font-size: 1.5rem;
}

.red { color: #e74c3c; }
.black { color: #2c3e50; }

.side-pile-group {
  position: relative;
}

.count {
  position: absolute;
  top: -10px;
  right: -10px;
  background: #34495e;
  color: white;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  display: flex;
  justify-content: center;
  align-items: center;
  font-size: 0.8rem;
  font-weight: bold;
}

.empty-slot {
  width: 60px;
  height: 90px;
  border: 2px dashed rgba(255,255,255,0.3);
  border-radius: 8px;
}

.deck-display {
  display: flex;
  align-items: center;
  gap: 10px;
}

.pile-shadow {
  box-shadow: 2px 2px 0 #fff, 4px 4px 0 #999;
}
</style>
