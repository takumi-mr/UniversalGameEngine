<template>
  <div class="highlow-view">
    <div class="header-board">
      <div class="round-badge">
        Round {{ state.round }}
      </div>
      <div
        class="status-msg"
        :class="{ 'is-finished': state.status === 'FINISHED' }"
      >
        {{ state.message }}
      </div>
    </div>

    <div class="table-area">
      <!-- Player 2 (Top) -->
      <div
        class="player-zone player2-zone"
        :class="{ 'active-turn': state.currentTurn === 2 }"
      >
        <div class="player-info">
          <div class="avatar">
            👤
          </div>
          <div class="name">
            Player 2 {{ state.players?.['2'] ? `(${state.players['2']})` : '' }}
          </div>
          <div class="score">
            Score: <span>{{ state.scores[2] }}</span>
          </div>
        </div>
        
        <div
          v-if="state.status === 'PLAYING' && state.currentTurn === 2"
          class="guess-controls"
        >
          <button
            class="guess-btn high"
            :disabled="!isMyTurn(2)"
            @click="makeGuess('HIGH')"
          >
            <span class="icon">▲</span> HIGH
          </button>
          <button
            class="guess-btn low"
            :disabled="!isMyTurn(2)"
            @click="makeGuess('LOW')"
          >
            <span class="icon">▼</span> LOW
          </button>
        </div>
        <div
          v-else
          class="status-placeholder"
        >
          {{ state.currentTurn === 2 ? 'Thinking...' : 'Waiting...' }}
        </div>
      </div>

      <!-- Center Board -->
      <div class="center-zone">
        <div class="card-display">
          <div class="card-label">
            BASE CARD
          </div>
          <div class="card-slot">
            <div
              v-if="state.baseCard"
              class="playing-card face-up"
            >
              <div
                class="card-inner"
                :class="{ 'is-red': state.baseCard.suit === '♥' || state.baseCard.suit === '♦' }"
              >
                <div class="top-left">
                  <div class="rank">
                    {{ getRankLabel(state.baseCard.rank) }}
                  </div>
                  <div class="suit">
                    {{ state.baseCard.suit }}
                  </div>
                </div>
                <div class="center-suit">
                  {{ state.baseCard.suit }}
                </div>
              </div>
            </div>
            <div
              v-else
              class="playing-card empty-slot"
            />
          </div>
        </div>

        <div class="vs-divider">
          <div class="deck-container">
            <div class="deck-count">
              {{ state.deck.length }}
            </div>
            <div
              class="deck-visual"
              :class="{ 'is-empty': state.deck.length === 0 }"
            />
          </div>
        </div>

        <div class="card-display result">
          <div class="card-label">
            RESULT
          </div>
          <div class="card-slot">
            <div
              v-if="state.lastResultCard"
              class="playing-card face-up result-anim"
            >
              <div
                class="card-inner"
                :class="{ 'is-red': state.lastResultCard.suit === '♥' || state.lastResultCard.suit === '♦' }"
              >
                <div class="top-left">
                  <div class="rank">
                    {{ getRankLabel(state.lastResultCard.rank) }}
                  </div>
                  <div class="suit">
                    {{ state.lastResultCard.suit }}
                  </div>
                </div>
                <div class="center-suit">
                  {{ state.lastResultCard.suit }}
                </div>
              </div>
            </div>
            <div
              v-else
              class="playing-card empty-slot"
            />
          </div>
        </div>
      </div>

      <!-- Player 1 (Bottom) -->
      <div
        class="player-zone player1-zone"
        :class="{ 'active-turn': state.currentTurn === 1 }"
      >
        <div
          v-if="state.status === 'PLAYING' && state.currentTurn === 1"
          class="guess-controls"
        >
          <button
            class="guess-btn high"
            :disabled="!isMyTurn(1)"
            @click="makeGuess('HIGH')"
          >
            <span class="icon">▲</span> HIGH
          </button>
          <button
            class="guess-btn low"
            :disabled="!isMyTurn(1)"
            @click="makeGuess('LOW')"
          >
            <span class="icon">▼</span> LOW
          </button>
        </div>
        <div
          v-else
          class="status-placeholder"
        >
          {{ state.currentTurn === 1 ? 'Thinking...' : 'Waiting...' }}
        </div>

        <div class="player-info">
          <div class="name">
            Player 1 {{ state.players?.['1'] ? `(${state.players['1']})` : '' }}
          </div>
          <div class="score">
            Score: <span>{{ state.scores[1] }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { HighLowState, HighLowAction } from '@engine/shared/rules/HighLowRuleset';

const props = defineProps<{ 
  state: HighLowState,
  myPlayerId?: string
}>();

const emit = defineEmits<{ (e: 'action', action: HighLowAction): void }>();

const getRankLabel = (rank: number) => {
  if (rank === 1) return 'A';
  if (rank === 11) return 'J';
  if (rank === 12) return 'Q';
  if (rank === 13) return 'K';
  return rank.toString();
};

const isMyTurn = (playerNumber: 1 | 2) => {
  if (!props.state.players) return false;
  return props.state.players[playerNumber] === props.myPlayerId;
};

const makeGuess = (choice: 'HIGH' | 'LOW') => {
  if (props.state.status !== 'PLAYING') return;
  emit('action', { type: 'GUESS', choice, playerId: props.myPlayerId });
};
</script>

<style scoped>
.highlow-view {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 100%;
  height: 100%;
  background: radial-gradient(circle at center, rgb(var(--v-theme-surface)) 0%, rgb(var(--v-theme-background)) 100%);
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
  max-width: 800px;
  background: rgba(255, 255, 255, 0.03);
  border-radius: 24px;
  border: 1px solid rgba(255, 255, 255, 0.05);
  padding: 40px;
  position: relative;
}

/* --- Player Zones --- */
.player-zone {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 20px;
  border-radius: 16px;
  transition: all 0.3s;
}

.player-zone.active-turn {
  background: rgba(59, 130, 246, 0.1);
  box-shadow: 0 0 20px rgba(59, 130, 246, 0.2);
}

.player-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.name { font-weight: bold; font-size: 1.2rem; color: #f8fafc; }
.score { color: #94a3b8; }
.score span { color: #facc15; font-size: 1.5rem; font-weight: bold; }

/* --- Guess Controls --- */
.guess-controls {
  display: flex;
  gap: 16px;
}

.guess-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 100px;
  height: 100px;
  border: none;
  border-radius: 20px;
  color: white;
  font-weight: bold;
  cursor: pointer;
  transition: all 0.2s;
}

.guess-btn .icon { font-size: 1.5rem; margin-bottom: 4px; }

.guess-btn.high { background: #ef4444; box-shadow: 0 4px 0 #b91c1c; }
.guess-btn.high:hover:not(:disabled) { background: #f87171; transform: translateY(-2px); box-shadow: 0 6px 0 #b91c1c; }

.guess-btn.low { background: #3b82f6; box-shadow: 0 4px 0 #1d4ed8; }
.guess-btn.low:hover:not(:disabled) { background: #60a5fa; transform: translateY(-2px); box-shadow: 0 6px 0 #1d4ed8; }

.guess-btn:active:not(:disabled) { transform: translateY(2px); box-shadow: 0 2px 0 #1d4ed8; }
.guess-btn:disabled { background: #475569; box-shadow: none; opacity: 0.5; cursor: not-allowed; }

.status-placeholder {
  color: #64748b;
  font-style: italic;
}

/* --- Center Zone --- */
.center-zone {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 40px;
  margin: 20px 0;
}

.card-display {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
}

.card-label {
  font-size: 0.8rem;
  font-weight: bold;
  color: #94a3b8;
  letter-spacing: 2px;
}

.card-slot {
  width: 120px;
  height: 168px;
}

.playing-card {
  width: 100%;
  height: 100%;
  border-radius: 12px;
  background: white;
  position: relative;
  box-shadow: 0 8px 16px rgba(0,0,0,0.3);
  color: black;
}

.empty-slot {
  background: rgba(0,0,0,0.2);
  border: 2px dashed rgba(255,255,255,0.1);
  box-shadow: none;
}

.result-anim {
  animation: dealCard 0.5s ease-out;
}

@keyframes dealCard {
  from { transform: translateX(100px) rotate(15deg); opacity: 0; }
  to { transform: translateX(0) rotate(0); opacity: 1; }
}

/* Card Inner */
.card-inner {
  width: 100%; height: 100%;
  padding: 12px;
}
.card-inner.is-red { color: #ef4444; }
.top-left { text-align: left; line-height: 1; }
.top-left .rank { font-size: 1.5rem; font-weight: bold; }
.top-left .suit { font-size: 1.2rem; }
.center-suit { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); font-size: 4rem; opacity: 0.9; }

/* VS Divider / Deck */
.vs-divider {
  display: flex;
  flex-direction: column;
  align-items: center;
}

.deck-container {
  position: relative;
  width: 60px;
  height: 84px;
}

.deck-count {
  position: absolute;
  top: -24px;
  width: 100%;
  text-align: center;
  font-weight: bold;
  color: #facc15;
}

.deck-visual {
  width: 100%;
  height: 100%;
  background: #1e293b;
  border: 2px solid #475569;
  border-radius: 8px;
  box-shadow: 
    -2px -2px 0 #334155,
    -4px -4px 0 #1e293b,
    -6px -6px 0 #334155;
}
</style>