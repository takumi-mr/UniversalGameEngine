import { computed, type ComputedRef } from "vue";
import type { BaseGameAction, BaseGameState, GameRuleset } from "@engine/shared/GameRules";

/** 盤面コンポーネントが GenericGameView / GenericReplayView から受け取る共通 props */
export interface GameSessionProps<S extends BaseGameState> {
  state: S;
  myPlayerId?: string;
}

export interface GameSession<A extends BaseGameAction> {
  /** 自分が着席しているか（false なら観戦者） */
  isPlayer: ComputedRef<boolean>;
  /** state.status === "PLAYING" */
  isPlaying: ComputedRef<boolean>;
  /** 自分が今アクションを起こせる手番か（state.activePlayers 基準） */
  isMyTurn: ComputedRef<boolean>;
  /** state.players 上の自分のロール（"1" / "-1" / "N" など）。未着席なら undefined */
  myRole: ComputedRef<string | undefined>;
  /** 今の自分の合法手。手番でなければ空 */
  legalActions: ComputedRef<A[]>;
  /** 条件を満たす合法手があるか。「このマスは押せるか」のような UI 判定に使う */
  can: (pred: (action: A) => boolean) => boolean;
  /**
   * アクションを送る。観戦者なら何もしない（各コンポーネントに散らばっていた観戦者ガード）。
   * 合法性の検証はサーバーが行うので、ここでは手番チェックまではしない
   * （麻雀の割り込みやリアルタイム系のように、手番概念に乗らないアクションもあるため）。
   */
  send: (action: A) => void;
}

/**
 * 盤面コンポーネント共通の「自分は誰で、今なにができるか」をまとめる composable。
 *
 * 合法手はルールセットの getLegalActions から取るので、コンポーネント側でルールを
 * 再実装せずに済む（例: `can((a) => a.type === "PLACE" && a.index === i)`）。
 *
 * @example
 * const props = defineProps<{ state: TicTacToeState; myPlayerId?: string }>();
 * const emit = defineEmits<{ (e: "action", action: TicTacToeAction): void }>();
 * const { can, send } = useGameSession(props, emit, TicTacToeRuleset);
 */
export function useGameSession<S extends BaseGameState, A extends BaseGameAction>(
  props: GameSessionProps<S>,
  emit: (e: "action", action: A) => void,
  ruleset: Pick<GameRuleset<S, A>, "getLegalActions">,
): GameSession<A> {
  const myId = () => props.myPlayerId ?? "";

  const myRole = computed(() => {
    const players = props.state.players;
    if (!players || !props.myPlayerId) return undefined;
    return Object.entries(players).find(([, id]) => id === props.myPlayerId)?.[0];
  });
  const isPlayer = computed(() => myRole.value !== undefined);
  const isPlaying = computed(() => props.state.status === "PLAYING");
  const isMyTurn = computed(
    () => isPlaying.value && isPlayer.value && !!props.state.activePlayers?.includes(myId()),
  );
  const legalActions = computed<A[]>(() =>
    isMyTurn.value ? ruleset.getLegalActions(props.state, myId()) : [],
  );

  const can = (pred: (action: A) => boolean) => legalActions.value.some(pred);

  const send = (action: A) => {
    if (!isPlayer.value) return;
    emit("action", { ...action, playerId: myId() });
  };

  return { isPlayer, isPlaying, isMyTurn, myRole, legalActions, can, send };
}
