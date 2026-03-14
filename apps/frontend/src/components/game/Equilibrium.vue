<template>
  <div class="equilibrium-container" ref="containerRef">
    <canvas ref="canvasRef" class="webgl-canvas"></canvas>

    <div class="hud-overlay" v-if="state && myData">
      
      <div class="top-bar">
        <div v-for="(pData, pId) in opponentData" :key="pId" class="player-badge enemy">
          <div class="name">Player: {{ pId }}</div>
          <div class="stats">❤️ {{ pData.hp }} | 👻 {{ pData.soulPoints }}</div>
          
          <div class="revealed-info" v-if="getRevealedCard(pData)">
            <div class="warning-text">⚠️ Exposed Card?</div>
            <div class="mini-card bluff-card">
              {{ getRevealedCard(pData)?.name }} ({{ getRevealedCard(pData)?.type }})
            </div>
          </div>
        </div>
      </div>

      <div class="center-screen" v-if="state.phase === 'AUCTION'">
        <div class="auction-panel" v-if="isMyTurn">
          <h3>Soul Auction</h3>
          <p>Bid your soul points for the center card!</p>
          <div class="bid-controls">
            <input type="range" v-model.number="bidAmount" min="1" :max="myData.soulPoints" class="slider" />
            <span class="bid-val">👻 {{ bidAmount }}</span>
          </div>
          <div class="action-buttons">
            <button class="btn-primary" @click="submitBid" :disabled="myData.soulPoints < 1">Place Bid</button>
            <button class="btn-secondary" @click="passAuction">Pass</button>
          </div>
        </div>
        <div class="waiting-panel" v-else>
          Waiting for other players to bid...
        </div>
      </div>

      <div class="bottom-bar">
        <div class="my-status player-badge">
          <div class="name">You ({{ myPlayerId }})</div>
          <div class="stats">❤️ {{ myData.hp }} | 👻 {{ myData.soulPoints }}</div>
          <div class="goal" v-if="myData.hiddenGoal">🎯 Goal: {{ myData.hiddenGoal.name }}</div>
        </div>

        <div class="hand-container">
          <div 
            v-for="card in myData.hand" 
            :key="card.id" 
            class="card"
            :class="{ disabled: state.phase !== 'MAIN' || !isMyTurn }"
          >
            <div class="card-title">{{ card.name }}</div>
            <div class="card-type">{{ card.type }}</div>
            <div class="card-cost">Cost: {{ card.cost }}👻</div>
            
            <div class="card-actions" v-if="state.phase === 'MAIN' && isMyTurn">
              
              <div v-if="pendingTargetCardId === card.id" class="target-selection">
                <div class="target-prompt">Select Target:</div>
                <div class="target-buttons">
                  <button 
                    v-for="opId in Object.keys(opponentData)" 
                    :key="opId"
                    class="btn-danger btn-small"
                    @click="confirmPlayWithTarget(card.id, opId)"
                  >
                    🎯 {{ opId }}
                  </button>
                </div>
                <button class="btn-secondary btn-small cancel-btn" @click="pendingTargetCardId = null">Cancel</button>
              </div>

              <template v-else>
                <button 
                  v-if="card.type !== 'GOAL'"
                  class="btn-primary" 
                  :disabled="myData.soulPoints < card.cost"
                  @click="initiatePlay(card)"
                >
                  Play
                </button>

                <button 
                  v-if="card.type === 'GOAL'"
                  class="btn-warning" 
                  @click="alterGoal(card.id)"
                >
                  Set Goal
                </button>

                <button 
                  class="btn-trick" 
                  :disabled="myData.soulPoints < 1"
                  @click="bluffReveal(card)"
                  title="Cost: 1 Soul Point"
                >
                  👁️ Bluff (1👻)
                </button>
              </template>
              
            </div>
          </div>
        </div>

        <div class="turn-controls" v-if="state.phase === 'MAIN' && isMyTurn">
          <button 
            class="btn-sacrifice" 
            @click="sacrifice" 
            :disabled="myData.hp <= 2"
            title="Sacrifice 2 HP to gain 1 Soul Point"
          >
            🩸 Sacrifice
          </button>
          <button class="btn-danger" @click="endTurn">End Turn</button>
        </div>
      </div>

    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue';
import { Equilibrium } from '../../three/Equilibrium';
import type { EquilibriumState, EquilibriumAction, Card } from '@engine/shared/rules/EquilibriumRuleset';

const props = defineProps<{
  state: EquilibriumState;
}>();

const emit = defineEmits<{
  (e: 'action', action: EquilibriumAction | any): void; 
}>();

// --- Refs ---
const containerRef = ref<HTMLElement | null>(null);
const canvasRef = ref<HTMLCanvasElement | null>(null);
let renderer3D: Equilibrium | null = null;

const bidAmount = ref(1);
const pendingTargetCardId = ref<string | null>(null);

// --- Computed ---
const myPlayerId = computed(() => {
  const me = Object.values(props.state.playerData).find((p: any) => p.hiddenGoal !== null);
  return me ? me.id : Object.keys(props.state.playerData)[0];
});

const myData = computed(() => props.state.playerData[myPlayerId.value]);
const opponentData = computed(() => {
  const data = { ...props.state.playerData };
  delete data[myPlayerId.value];
  return data;
});
const isMyTurn = computed(() => props.state.activePlayers?.includes(myPlayerId.value));

// --- Helpers ---
const getRevealedCard = (opponentData: any) => {
  return opponentData.hand.find((c: any) => c.id !== 'hidden');
};

// --- Actions ---
const submitBid = () => {
  emit('action', { type: 'BID', playerId: myPlayerId.value, amount: bidAmount.value });
  bidAmount.value = 1;
};
const passAuction = () => emit('action', { type: 'PASS_AUCTION', playerId: myPlayerId.value });
const endTurn = () => emit('action', { type: 'END_TURN', playerId: myPlayerId.value });

// サクリファイス処理
const sacrifice = () => {
  emit('action', { type: 'SACRIFICE', playerId: myPlayerId.value });
};

const alterGoal = (newGoalCardId: string) => {
  emit('action', { type: 'ALTER_GOAL', playerId: myPlayerId.value, newGoalCardId });
};

const bluffReveal = (fakeCard: any) => {
  emit('action', { type: 'BLUFF_REVEAL', playerId: myPlayerId.value, fakeCard });
};

// ★ 変更: 対象選択が必要なカードの条件式を拡張
const initiatePlay = (card: Card) => {
  // 攻撃、吸収(SYPHON)、または手札破壊(Corruption)の場合にターゲット選択UIを開く
  if (card.type === 'ATTACK' || card.type === 'SYPHON' || card.name === 'Corruption') {
    pendingTargetCardId.value = card.id;
  } else {
    emit('action', { type: 'PLAY_CARD', playerId: myPlayerId.value, cardId: card.id });
  }
};

const confirmPlayWithTarget = (cardId: string, targetId: string) => {
  emit('action', { 
    type: 'PLAY_CARD', 
    playerId: myPlayerId.value, 
    cardId, 
    targetId 
  });
  pendingTargetCardId.value = null;
};

// --- Lifecycle & 3D Sync ---
onMounted(() => {
  if (canvasRef.value && containerRef.value) {
    renderer3D = new Equilibrium(canvasRef.value);
    
    const resizeObserver = new ResizeObserver((entries) => {
      for (let entry of entries) {
        renderer3D?.resize(entry.contentRect.width, entry.contentRect.height);
      }
    });
    resizeObserver.observe(containerRef.value);

    renderer3D.updateState(props.state, myPlayerId.value);
  }
});

watch(() => props.state, (newState) => {
  if (newState && renderer3D) {
    renderer3D.updateState(newState, myPlayerId.value);
  }
  if (newState.phase !== 'MAIN' || !isMyTurn.value) {
    pendingTargetCardId.value = null;
  }
}, { deep: true });

onBeforeUnmount(() => {
  renderer3D?.destroy();
});
</script>

<style scoped>
/* 既存のスタイルをそのまま維持 */
.equilibrium-container { position: relative; width: 100%; height: 100%; overflow: hidden; border-radius: 12px; }
.webgl-canvas { display: block; width: 100%; height: 100%; }

.hud-overlay { position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; display: flex; flex-direction: column; justify-content: space-between; padding: 20px; }
.hud-overlay > * { pointer-events: auto; }

.player-badge { background: rgba(15, 23, 42, 0.85); border: 1px solid rgba(255, 255, 255, 0.1); padding: 10px 16px; border-radius: 8px; backdrop-filter: blur(4px); }
.enemy { align-self: flex-start; border-color: rgba(248, 113, 113, 0.3); }
.name { font-weight: bold; color: #e2e8f0; font-size: 0.9rem; }
.stats { font-family: monospace; font-size: 1.1rem; margin-top: 4px; }
.goal { color: #c4b5fd; font-size: 0.8rem; margin-top: 4px; }

.revealed-info { margin-top: 10px; padding-top: 8px; border-top: 1px dashed rgba(255, 255, 255, 0.2); }
.warning-text { font-size: 0.7rem; color: #fbbf24; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 4px; }
.mini-card { background: rgba(0, 0, 0, 0.6); border: 1px solid #fbbf24; padding: 4px 8px; border-radius: 4px; font-size: 0.8rem; color: #fcd34d; }
.bluff-card { animation: pulse-glow 2s infinite alternate; }

@keyframes pulse-glow { from { box-shadow: 0 0 2px #fbbf24; } to { box-shadow: 0 0 10px #f59e0b; } }

.center-screen { flex: 1; display: flex; justify-content: center; align-items: center; }
.auction-panel, .waiting-panel { background: rgba(30, 41, 59, 0.9); padding: 24px; border-radius: 16px; border: 1px solid #6366f1; text-align: center; box-shadow: 0 10px 25px rgba(0,0,0,0.5); }
.auction-panel h3 { margin: 0 0 10px; color: #818cf8; }
.bid-controls { display: flex; align-items: center; gap: 15px; margin: 20px 0; }
.slider { flex: 1; cursor: pointer; }
.bid-val { font-size: 1.2rem; font-weight: bold; }

.bottom-bar { display: flex; align-items: flex-end; gap: 20px; }
.hand-container { display: flex; gap: 10px; flex: 1; overflow-x: auto; padding-bottom: 5px; }
.card { width: 120px; background: linear-gradient(145deg, #1e293b, #0f172a); border: 1px solid #475569; border-radius: 8px; padding: 12px; display: flex; flex-direction: column; gap: 8px; transition: transform 0.2s; }
.card.disabled { opacity: 0.5; filter: grayscale(1); pointer-events: none; }
.card:not(.disabled):hover { transform: translateY(-10px); }
.card-title { font-weight: bold; font-size: 0.9rem; text-align: center; }
.card-type { font-size: 0.7rem; color: #94a3b8; text-align: center; }
.card-cost { font-size: 0.8rem; color: #fbbf24; text-align: center; font-weight: bold; }

button { border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-weight: bold; transition: 0.2s; }
button:disabled { cursor: not-allowed; opacity: 0.5; }

.btn-primary { background: #6366f1; color: white; }
.btn-primary:hover:not(:disabled) { background: #4f46e5; }
.btn-secondary { background: #475569; color: white; }
.btn-secondary:hover:not(:disabled) { background: #334155; }
.btn-danger { background: #ef4444; color: white; }
.btn-danger:hover:not(:disabled) { background: #dc2626; }
.btn-warning { background: #f59e0b; color: #fff; }
.btn-warning:hover:not(:disabled) { background: #d97706; }
.btn-trick { background: transparent; border: 1px solid #a855f7; color: #c084fc; font-size: 0.75rem; }
.btn-trick:hover:not(:disabled) { background: rgba(168, 85, 247, 0.2); }

/* Sacrifice ボタンスタイル */
.turn-controls { display: flex; gap: 10px; }
.btn-sacrifice { background: #9f1239; color: white; border: 1px solid #fda4af; }
.btn-sacrifice:hover:not(:disabled) { background: #be123c; }

.card-actions { display: flex; flex-direction: column; gap: 6px; margin-top: auto; }
.target-selection { display: flex; flex-direction: column; gap: 6px; background: rgba(0, 0, 0, 0.4); padding: 8px; border-radius: 6px; border: 1px dashed #ef4444; }
.target-prompt { font-size: 0.75rem; color: #f87171; text-align: center; font-weight: bold; }
.target-buttons { display: flex; gap: 4px; flex-wrap: wrap; justify-content: center; }
.btn-small { padding: 4px 8px; font-size: 0.7rem; }
.cancel-btn { margin-top: 4px; width: 100%; }
</style>