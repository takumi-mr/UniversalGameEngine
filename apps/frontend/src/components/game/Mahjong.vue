<template>
  <div class="mahjong-view" v-if="state">
    <!-- The Table -->
    <div class="mahjong-table-container">
      <div class="mahjong-table">
        <!-- Center Info Area -->
        <div class="center-info">
          <div class="round-indicator">
            {{ $t('games.mahjong.round', { wind: $t(`games.mahjong.winds.${state.wind}`), round: state.round }) }}
          </div>
          <div class="dora-box">
            <span class="dora-label">{{ $t('games.mahjong.dora') }}:</span>
            <MahjongTile 
              v-for="(tile, i) in state.doraIndicators" 
              :key="'dora-'+i" 
              :tile="tile" 
              size="small"
            />
          </div>
          <div class="wall-count">
            🀫 {{ state.wall.length }}
          </div>
        </div>

        <!-- Top: Opponent (Across) -->
        <div class="player-area top">
          <div class="player-label">{{ pIdAcross || '?' }}</div>
          <div class="discards-grid">
            <MahjongTile v-for="(tile, i) in discardsAcross" :key="'da-'+i" :tile="tile" />
          </div>
          <div class="hand-row">
            <MahjongTile v-for="i in handCountAcross" :key="'ha-'+i" tile="?" hidden />
          </div>
        </div>

        <!-- Left: Opponent (Kami-cha) -->
        <div class="player-area left">
          <div class="player-label">{{ pIdLeft || '?' }}</div>
          <div class="discards-grid">
            <MahjongTile v-for="(tile, i) in discardsLeft" :key="'dl-'+i" :tile="tile" />
          </div>
          <div class="hand-row">
            <MahjongTile v-for="i in handCountLeft" :key="'hl-'+i" tile="?" hidden />
          </div>
        </div>

        <!-- Right: Opponent (Shimo-cha) -->
        <div class="player-area right">
          <div class="player-label">{{ pIdRight || '?' }}</div>
          <div class="discards-grid">
            <MahjongTile v-for="(tile, i) in discardsRight" :key="'dr-'+i" :tile="tile" />
          </div>
          <div class="hand-row">
            <MahjongTile v-for="i in handCountRight" :key="'hr-'+i" tile="?" hidden />
          </div>
        </div>

        <!-- Bottom: Me (Jibun) -->
        <div class="player-area bottom" :class="{ 'is-active': isMyTurn }">
          <div class="player-label">{{ myPlayerId }}</div>
          <div class="discards-grid">
            <MahjongTile v-for="(tile, i) in discardsMe" :key="'dm-'+i" :tile="tile" />
          </div>
          
          <div class="actions-bar" v-if="availableActions.length > 0">
            <v-btn 
              v-for="action in availableActions" 
              :key="action.type + (action.meldType || '')"
              variant="elevated"
              :color="getActionColor(action.type)"
              class="action-btn"
              @click="emitAction(action)"
            >
              {{ getActionLabel(action) }}
            </v-btn>
          </div>

          <div class="hand-row my-hand">
            <MahjongTile 
              v-for="(tile, i) in myHand" 
              :key="'hm-'+i" 
              :tile="tile" 
              :clickable="isMyTurn && state.status === 'PLAYING'"
              @click="handleTileClick(tile)"
            />
          </div>
        </div>
      </div>
    </div>

    <!-- Result Overlay -->
    <div v-if="state.status === 'FINISHED'" class="result-overlay">
      <div class="result-card">
        <h2>{{ $t('games.mahjong.finished') }}</h2>
        <p class="final-message">{{ state.message }}</p>
        <div class="scores-list">
          <div v-for="(score, pid) in state.scores" :key="pid" class="score-item">
            <span class="pid">{{ pid }}{{ pid === myPlayerId ? ` (${$t('common.logged_in_as', { username: '' }).split(':')[0]})` : '' }}</span>
            <span class="score" :class="{ 'positive': score >= 25000, 'negative': score < 25000 }">
              {{ score }}
            </span>
          </div>
        </div>
      </div>
    </div>

    <!-- Start Game Overlay -->
    <div v-if="showStartOverlay" class="start-overlay">
      <div class="start-card">
        <h2>{{ $t('games.mahjong.waiting_players') }}</h2>
        <div class="player-slots">
          <div v-for="i in 4" :key="i - 1" class="slot" :class="{ 'filled': playerAtSlot(i - 1) }">
            {{ playerAtSlot(i - 1) || $t('games.mahjong.empty_slot') }}
          </div>
        </div>
        <v-btn 
          v-if="canStart"
          color="primary" 
          size="large" 
          @click="emitAction({ type: 'START', playerId: myPlayerId })"
        >
          {{ $t('games.mahjong.actions.START') }}
        </v-btn>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import type { MahjongState, MahjongAction } from '@engine/shared/rules/mahjong/MahjongRuleset';
import MahjongTile from './MahjongTile.vue';

const { t: $t } = useI18n();

const props = defineProps<{
  state: MahjongState;
  myPlayerId: string;
}>();

const emit = defineEmits<{ (e: 'action', action: MahjongAction): void }>();

// --- Helpers ---
const playerIndexMe = computed(() => {
  if (!props.myPlayerId) return 0;
  const idx = props.state.playerIds.indexOf(props.myPlayerId);
  return idx === -1 ? 0 : idx;
});
const isMyTurn = computed(() => props.state.activePlayers?.includes(props.myPlayerId || ''));

const getPlayerAtOffset = (offset: number) => {
  if (props.state.playerIds.length < 4) return '';
  const idx = (playerIndexMe.value + offset) % 4;
  return props.state.playerIds[idx];
};

const playerAtSlot = (i: number) => {
  return props.state.players?.[i];
};

const isUninitialized = computed(() => {
  return props.state.status === 'PLAYING' && Object.keys(props.state.hands || {}).length === 0;
});

const showStartOverlay = computed(() => {
  return props.state.status === 'WAITING' || isUninitialized.value;
});

const canStart = computed(() => {
  const players = props.state.players || {};
  const joinedCount = Object.values(players).filter(p => p !== null).length;
  return joinedCount === 4 && showStartOverlay.value;
});

// Data for each position
const myHand = computed(() => props.state.hands[props.myPlayerId || ''] || []);
const discardsMe = computed(() => props.state.discards[props.myPlayerId || ''] || []);

const pIdAcross = computed(() => getPlayerAtOffset(2));
const discardsAcross = computed(() => props.state.discards[pIdAcross.value] || []);
const handCountAcross = computed(() => props.state.hands[pIdAcross.value]?.length || 0);

const pIdLeft = computed(() => getPlayerAtOffset(3));
const discardsLeft = computed(() => props.state.discards[pIdLeft.value] || []);
const handCountLeft = computed(() => props.state.hands[pIdLeft.value]?.length || 0);

const pIdRight = computed(() => getPlayerAtOffset(1));
const discardsRight = computed(() => props.state.discards[pIdRight.value] || []);
const handCountRight = computed(() => props.state.hands[pIdRight.value]?.length || 0);

// Actions
const availableActions = computed(() => {
  if (!props.myPlayerId) return [];
  const actions: MahjongAction[] = [];
  
  if (props.state.pendingDiscard && props.state.pendingDiscard.playerId !== props.myPlayerId) {
    const hasActed = props.state.pendingDiscard.pendingActions.some(a => a.playerId === props.myPlayerId);
    if (!hasActed) {
      actions.push({ type: 'PASS', playerId: props.myPlayerId });
      actions.push({ type: 'RON', playerId: props.myPlayerId });
      actions.push({ type: 'CALL', meldType: 'PON', tile: props.state.pendingDiscard.tile, playerId: props.myPlayerId });
      actions.push({ type: 'CALL', meldType: 'CHI', tile: props.state.pendingDiscard.tile, playerId: props.myPlayerId });
    }
  } else if (isMyTurn.value) {
    const hand = myHand.value;
    if (hand.length === 13) {
      actions.push({ type: 'DRAW', playerId: props.myPlayerId });
    } else if (hand.length === 14) {
      actions.push({ type: 'TSUMO', playerId: props.myPlayerId });
    }
  }
  return actions;
});

const handleTileClick = (tile: string) => {
  if (!isMyTurn.value || myHand.value.length !== 14) return;
  emit('action', { type: 'DISCARD', tile, playerId: props.myPlayerId });
};

const emitAction = (action: MahjongAction) => {
  emit('action', action);
}

const getActionLabel = (action: MahjongAction) => {
  if (action.type === 'CALL') return $t(`games.mahjong.actions.${action.meldType}`);
  return $t(`games.mahjong.actions.${action.type}`);
};

const getActionColor = (type: string) => {
  if (type === 'RON' || type === 'TSUMO') return 'error';
  if (type === 'CALL') return 'warning';
  if (type === 'PASS') return 'grey-lighten-1';
  return 'primary';
};
</script>

<style scoped>
.mahjong-view {
  width: 100%;
  height: 100%;
  background-color: #1a1a1a;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  overflow: auto; /* Allow scrolling if table is larger than window */
  color: white;
  padding: 40px;
}

.mahjong-table-container {
  width: 800px;
  height: 800px;
  background-color: #2e7d32;
  border: 12px solid #5d4037;
  border-radius: 12px;
  box-shadow: 0 0 50px rgba(0,0,0,0.6);
  position: relative;
  flex-shrink: 0; /* Prevent from shrinking in the flex container */
}

.mahjong-table {
  width: 100%;
  height: 100%;
  position: relative;
}

/* Center Area */
.center-info {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 180px;
  height: 180px;
  background: rgba(0,0,0,0.4);
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  z-index: 10;
  border: 2px solid rgba(255,255,255,0.1);
}

.round-indicator {
  font-size: 1.5rem;
  font-weight: bold;
  margin-bottom: 8px;
}

.dora-box {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.player-area {
  position: absolute;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.bottom { bottom: 10px; left: 50%; transform: translateX(-50%); }
.top    { top: 10px; left: 50%; transform: translateX(-50%) rotate(180deg); }
.left   { left: 60px; top: 50%; transform: translate(-50%, -50%) rotate(90deg); }
.right  { right: 60px; top: 50%; transform: translate(50%, -50%) rotate(-90deg); }

.player-label {
  background: rgba(0,0,0,0.7);
  padding: 2px 10px;
  border-radius: 10px;
  font-size: 0.8rem;
  margin-bottom: 4px;
  border: 1px solid rgba(255,255,255,0.2);
}

.hand-row {
  display: flex;
  justify-content: center;
  gap: 2px;
  z-index: 2;
}

.discards-grid {
  display: grid;
  grid-template-columns: repeat(6, 32px);
  grid-auto-rows: 44px;
  gap: 1px;
  margin-bottom: 8px;
  z-index: 1;
  background: rgba(255,255,255,0.05);
  padding: 4px;
  border-radius: 4px;
}

.left .discards-grid, .right .discards-grid {
  grid-template-columns: repeat(3, 32px);
}

.actions-bar {
  display: flex;
  gap: 8px;
  margin-bottom: 10px;
}

.result-overlay, .start-overlay {
  position: absolute;
  top: 0; left: 0; right: 0; bottom: 0;
  background: rgba(0,0,0,0.8);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}

.result-card, .start-card {
  background: white;
  color: #333;
  padding: 30px;
  border-radius: 12px;
  text-align: center;
  min-width: 320px;
}

.player-slots {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;
  margin: 20px 0;
}

.slot {
  padding: 10px;
  border: 2px dashed #ccc;
  border-radius: 6px;
  color: #666;
}

.slot.filled {
  border-style: solid;
  border-color: #2e7d32;
  color: #2e7d32;
  font-weight: bold;
}

.scores-list { margin-top: 15px; text-align: left; }
.score-item { display: flex; justify-content: space-between; padding: 5px 0; border-bottom: 1px solid #eee; }
</style>
