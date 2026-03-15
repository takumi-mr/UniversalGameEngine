<template>
  <div class="mahjong-view" v-if="state">
    <!-- Game Info Overlay -->
    <div class="game-info-overlay">
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
        🀫 {{ $t('games.mahjong.remaining_tiles') }}: {{ state.wall.length }}
      </div>
    </div>

    <!-- The Table -->
    <div class="mahjong-table">
      <!-- Top: Opponent (Across) -->
      <div class="player-position top">
        <div class="discards-grid">
          <MahjongTile v-for="(tile, i) in discardsAcross" :key="'da-'+i" :tile="tile" />
        </div>
        <div class="hand-row opponent-hand">
          <MahjongTile v-for="i in handCountAcross" :key="'ha-'+i" tile="?" hidden />
        </div>
        <div class="melds-row">
          <MahjongTile v-for="(m, i) in meldsAcross" :key="'ma-'+i" :tile="m.tile" horizontal />
        </div>
      </div>

      <!-- Left: Opponent (Kami-cha) -->
      <div class="player-position left">
        <div class="discards-grid">
          <MahjongTile v-for="(tile, i) in discardsLeft" :key="'dl-'+i" :tile="tile" />
        </div>
        <div class="hand-row opponent-hand vertical">
          <MahjongTile v-for="i in handCountLeft" :key="'hl-'+i" tile="?" hidden />
        </div>
        <div class="melds-row">
          <MahjongTile v-for="(m, i) in meldsLeft" :key="'ml-'+i" :tile="m.tile" horizontal />
        </div>
      </div>

      <!-- Right: Opponent (Shimo-cha) -->
      <div class="player-position right">
        <div class="discards-grid">
          <MahjongTile v-for="(tile, i) in discardsRight" :key="'dr-'+i" :tile="tile" />
        </div>
        <div class="hand-row opponent-hand vertical">
          <MahjongTile v-for="i in handCountRight" :key="'hr-'+i" tile="?" hidden />
        </div>
        <div class="melds-row">
          <MahjongTile v-for="(m, i) in meldsRight" :key="'mr-'+i" :tile="m.tile" horizontal />
        </div>
      </div>

      <!-- Bottom: Me (Jibun) -->
      <div class="player-position bottom" :class="{ 'is-active': isMyTurn }">
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
        <div class="melds-row">
          <MahjongTile v-for="(m, i) in meldsMe" :key="'mm-'+i" :tile="m.tile" horizontal />
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
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { MahjongState, MahjongAction } from '@engine/shared/rules/mahjong/MahjongRuleset';
import MahjongTile from './MahjongTile.vue';
import { useI18n } from 'vue-i18n';

const { t: $t } = useI18n();

const props = defineProps<{
  state: MahjongState;
  myPlayerId?: string;
}>();

const emit = defineEmits<{ (e: 'action', action: MahjongAction): void }>();

// --- Helpers ---
const playerIndexMe = computed(() => props.state.playerIds.indexOf(props.myPlayerId || ''));
const isMyTurn = computed(() => props.state.activePlayers?.includes(props.myPlayerId || ''));

const getPlayerAtOffset = (offset: number) => {
  const idx = (playerIndexMe.value + offset) % 4;
  return props.state.playerIds[idx];
};

// Data for each position
const myHand = computed(() => props.state.hands[props.myPlayerId || ''] || []);
const discardsMe = computed(() => props.state.discards[props.myPlayerId || ''] || []);
const meldsMe = computed(() => props.state.melds[props.myPlayerId || ''] || []);

const pIdAcross = computed(() => getPlayerAtOffset(2));
const discardsAcross = computed(() => props.state.discards[pIdAcross.value] || []);
const handCountAcross = computed(() => props.state.hands[pIdAcross.value]?.length || 0);
const meldsAcross = computed(() => props.state.melds[pIdAcross.value] || []);

const pIdLeft = computed(() => getPlayerAtOffset(3));
const discardsLeft = computed(() => props.state.discards[pIdLeft.value] || []);
const handCountLeft = computed(() => props.state.hands[pIdLeft.value]?.length || 0);
const meldsLeft = computed(() => props.state.melds[pIdLeft.value] || []);

const pIdRight = computed(() => getPlayerAtOffset(1));
const discardsRight = computed(() => props.state.discards[pIdRight.value] || []);
const handCountRight = computed(() => props.state.hands[pIdRight.value]?.length || 0);
const meldsRight = computed(() => props.state.melds[pIdRight.value] || []);

// Actions
const availableActions = computed(() => {
  if (!props.myPlayerId) return [];
  // Normally we'd use getLegalActions from ruleset, but here we can simulate/filter
  const actions: MahjongAction[] = [];
  
  if (props.state.pendingDiscard && props.state.pendingDiscard.playerId !== props.myPlayerId) {
    // Interruption phase
    const hasActed = props.state.pendingDiscard.pendingActions.some(a => a.playerId === props.myPlayerId);
    if (!hasActed) {
      actions.push({ type: 'PASS', playerId: props.myPlayerId });
      actions.push({ type: 'RON', playerId: props.myPlayerId });
      actions.push({ type: 'CALL', meldType: 'PON', tile: props.state.pendingDiscard.tile, playerId: props.myPlayerId });
      actions.push({ type: 'CALL', meldType: 'CHI', tile: props.state.pendingDiscard.tile, playerId: props.myPlayerId });
    }
  } else if (isMyTurn.value) {
    // Tsmo phase
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
  background: radial-gradient(circle, #2e7d32 0%, #1b5e20 100%);
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  overflow: hidden;
  color: white;
}

.mahjong-table {
  width: 90%;
  height: 90%;
  position: relative;
  border: 15px solid #5d4037;
  border-radius: 20px;
  background-color: #1b5e20;
}

.player-position {
  position: absolute;
  display: flex;
  flex-direction: column;
  align-items: center;
  transition: box-shadow 0.3s ease;
}

.player-position.is-active {
  box-shadow: 0 0 20px rgba(255, 255, 0, 0.3);
}

.bottom { bottom: 10px; left: 50%; transform: translateX(-50%); width: 100%; }
.top    { top: 10px; left: 50%; transform: translateX(-50%) rotate(180deg); width: 100%; }
.left   { left: 10px; top: 50%; transform: translateY(-50%) rotate(90deg); width: 100%; }
.right  { right: 10px; top: 50%; transform: translateY(-50%) rotate(-90deg); width: 100%; }

.hand-row {
  display: flex;
  justify-content: center;
  gap: 2px;
}

.discards-grid {
  display: grid;
  grid-template-columns: repeat(6, 40px);
  grid-auto-rows: 54px;
  gap: 2px;
  margin-bottom: 10px;
  justify-content: center;
}

/* Info Overlay */
.game-info-overlay {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  z-index: 5;
  background: rgba(0,0,0,0.5);
  padding: 10px 20px;
  border-radius: 8px;
  text-align: center;
  backdrop-filter: blur(4px);
  border: 1px solid rgba(255,255,255,0.1);
}

.round-indicator { font-size: 1.5rem; font-weight: bold; margin-bottom: 8px; }
.wall-count { font-size: 0.9rem; opacity: 0.8; }
.dora-box { display: flex; align-items: center; gap: 8px; margin: 8px 0; }

/* Actions */
.actions-bar {
  position: absolute;
  top: -60px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  gap: 12px;
  z-index: 10;
}

/* Result Card */
.result-overlay {
  position: absolute;
  top: 0; left: 0; right: 0; bottom: 0;
  background: rgba(0,0,0,0.8);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}

.result-card {
  background: white;
  color: #333;
  padding: 32px;
  border-radius: 16px;
  min-width: 320px;
  text-align: center;
  box-shadow: 0 10px 30px rgba(0,0,0,0.5);
}

.scores-list { margin-top: 20px; text-align: left; }
.score-item { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #eee; }
.score.positive { color: #2e7d32; font-weight: bold; }
.score.negative { color: #c62828; }
</style>
