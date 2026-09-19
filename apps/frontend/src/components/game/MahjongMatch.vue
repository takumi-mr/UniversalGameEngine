<template>
  <div class="mahjong-match">
    <MahjongTable
      :hand="hand"
      :my-player-id="myPlayerId"
      :legal-actions="handActions"
      :result="shownResult"
      dismissible
      @action="sendSubAction"
      @dismiss-result="dismissedGameId = state.currentGameId"
    />

    <!-- 対局情報（東風 / 半荘、局数、現在の順位） -->
    <div class="match-hud">
      <div class="mode">{{ $t(`games.mahjong_match.modes.${state.mode}`) }}</div>
      <ol class="ranking">
        <li v-for="id in state.ranking" :key="id" :class="{ me: id === myPlayerId }">
          <span class="rank-name">{{ id }}</span>
          <span class="rank-score">{{ (state.scores[id] ?? 0).toLocaleString() }}</span>
        </li>
      </ol>
    </div>

    <!-- 対局終了 -->
    <div v-if="state.status === 'FINISHED'" class="final-overlay">
      <div class="final-card">
        <h2>{{ $t("games.mahjong_match.final") }}</h2>
        <ol class="final-ranking">
          <li v-for="id in state.ranking" :key="id" :class="{ me: id === myPlayerId }">
            <span class="rank-name">{{ id }}</span>
            <span class="rank-score">{{ (state.scores[id] ?? 0).toLocaleString() }}</span>
          </li>
        </ol>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import {
  MahjongMatchRuleset,
  type MahjongMatchAction,
  type MahjongMatchState,
} from "@engine/shared/rules/mahjong/MahjongMatchRuleset";
import type { MahjongAction, MahjongState } from "@engine/shared/rules/mahjong/MahjongRuleset";
import { useGameSession } from "@/composables/useGameSession";
import MahjongTable from "@/components/game/MahjongTable.vue";
import { rewrapForRules } from "@/utils/mahjong";

// 東風戦・半荘戦。現在の局（currentGame.state）を MahjongTable に渡し、
// 卓からのアクションは SUBGAME_ACTION に包んで送る
const props = defineProps<{
  state: MahjongMatchState;
  myPlayerId?: string;
}>();

const emit = defineEmits<{ (e: "action", action: MahjongMatchAction): void }>();

// マスク済み状態のままでは手牌を読めないので、合法手の計算時だけ現在局を Secret に包み直す
const { legalActions, send } = useGameSession(props, emit, {
  getLegalActions: (state, id) =>
    MahjongMatchRuleset.getLegalActions(
      {
        ...state,
        currentGame: {
          ...state.currentGame,
          state: rewrapForRules(state.currentGame.state as MahjongState),
        },
      },
      id,
    ),
});

const hand = computed(() => props.state.currentGame.state as MahjongState);

/** 対局の合法手（SUBGAME_ACTION）を局のアクションに展開する。開始前の START はそのまま */
const handActions = computed<MahjongAction[]>(() =>
  legalActions.value.map((action) =>
    action.type === "SUBGAME_ACTION"
      ? (action.subAction as MahjongAction)
      : { type: "START", playerId: action.playerId },
  ),
);

const sendSubAction = (action: MahjongAction) => {
  if (action.type === "START" && props.state.status === "WAITING") {
    send({ type: "START" });
    return;
  }
  send({ type: "SUBGAME_ACTION", subAction: action });
};

// 局の結果は次の局の状態と同時に届くので、閉じるまで直前の結果として表示する
const dismissedGameId = ref("");
const shownResult = computed(() =>
  props.state.lastResult && dismissedGameId.value !== props.state.currentGameId
    ? props.state.lastResult
    : undefined,
);
</script>

<style scoped>
.mahjong-match {
  position: relative;
  width: 100%;
  height: 100%;
}

.match-hud {
  position: absolute;
  z-index: 5;
  top: 96px;
  left: 12px;
  background: rgba(0, 0, 0, 0.6);
  color: #ddd;
  padding: 8px 12px;
  border-radius: 8px;
  font-size: 0.8rem;
  pointer-events: none;
}

.mode {
  font-weight: bold;
  margin-bottom: 4px;
}

.ranking,
.final-ranking {
  margin: 0;
  padding-left: 1.4em;
}

.ranking li,
.final-ranking li {
  display: flex;
  gap: 12px;
  justify-content: space-between;
}

.ranking li.me,
.final-ranking li.me {
  color: #ffd54f;
  font-weight: bold;
}

.final-overlay {
  position: absolute;
  inset: 0;
  z-index: 30;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.6);
}

.final-card {
  background: #1e1e24;
  color: #f5f5f5;
  border-radius: 12px;
  padding: 24px 32px;
  min-width: 280px;
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.6);
}

.final-card h2 {
  margin: 0 0 12px;
  text-align: center;
}

.final-ranking li {
  font-size: 1.05rem;
  padding: 4px 0;
}
</style>
