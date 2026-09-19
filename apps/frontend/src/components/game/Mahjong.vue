<template>
  <MahjongTable
    :hand="state"
    :my-player-id="myPlayerId"
    :legal-actions="legalActions"
    :result="state.result"
    @action="send"
  />
</template>

<script setup lang="ts">
import { MahjongRuleset } from "@engine/shared/rules/mahjong/MahjongRuleset";
import type { MahjongState, MahjongAction } from "@engine/shared/rules/mahjong/MahjongRuleset";
import { useGameSession } from "@/composables/useGameSession";
import MahjongTable from "@/components/game/MahjongTable.vue";
import { rewrapForRules } from "@/utils/mahjong";

// リーチ麻雀の 1 局戦。卓の描画と操作は MahjongTable に任せ、ここは合法手と送信の配線だけ
const props = defineProps<{
  state: MahjongState;
  myPlayerId?: string;
}>();

const emit = defineEmits<{ (e: "action", action: MahjongAction): void }>();

// マスク済み状態のままでは手牌を読めないので、合法手の計算時だけ Secret に包み直す
const { legalActions, send } = useGameSession(props, emit, {
  getLegalActions: (state, id) => MahjongRuleset.getLegalActions(rewrapForRules(state), id),
});
</script>
