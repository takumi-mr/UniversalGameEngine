import { describe, it, expect, vi } from "vitest";
import { reactive } from "vue";
import { TicTacToeRuleset } from "@engine/shared/rules/TicTacToeRuleset";
import type { TicTacToeAction, TicTacToeState } from "@engine/shared/rules/TicTacToeRuleset";
import { useGameSession } from "@/composables/useGameSession";

const makeState = (over: Partial<TicTacToeState> = {}): TicTacToeState => ({
  ...TicTacToeRuleset.getInitialState(),
  status: "PLAYING",
  players: { 1: "alice", "-1": "bob" },
  activePlayers: ["alice"],
  ...over,
});

const setup = (state: TicTacToeState, myPlayerId?: string) => {
  const props = reactive({ state, myPlayerId });
  const emit = vi.fn<(e: "action", a: TicTacToeAction) => void>();
  const session = useGameSession(props, emit, TicTacToeRuleset);
  return { props, emit, session };
};

describe("useGameSession", () => {
  it("着席していれば isPlayer / myRole が立つ", () => {
    const { session } = setup(makeState(), "bob");
    expect(session.isPlayer.value).toBe(true);
    expect(session.myRole.value).toBe("-1");
    expect(session.isMyTurn.value).toBe(false);
  });

  it("観戦者は isPlayer が false で、send しても emit されない", () => {
    const { session, emit } = setup(makeState(), "carol");
    expect(session.isPlayer.value).toBe(false);
    expect(session.myRole.value).toBeUndefined();
    session.send({ type: "PLACE", index: 0 });
    expect(emit).not.toHaveBeenCalled();
  });

  it("手番なら合法手が取れ、can で判定できる", () => {
    const { session } = setup(makeState({ board: [1, 0, 0, 0, 0, 0, 0, 0, 0] }), "alice");
    expect(session.isMyTurn.value).toBe(true);
    expect(session.legalActions.value).toHaveLength(8);
    expect(session.can((a) => a.index === 0)).toBe(false);
    expect(session.can((a) => a.index === 4)).toBe(true);
  });

  it("手番でなければ合法手は空", () => {
    const { session } = setup(makeState(), "bob");
    expect(session.legalActions.value).toEqual([]);
    expect(session.can(() => true)).toBe(false);
  });

  it("FINISHED では isMyTurn が false", () => {
    const { session } = setup(makeState({ status: "FINISHED" }), "alice");
    expect(session.isPlaying.value).toBe(false);
    expect(session.isMyTurn.value).toBe(false);
  });

  it("send は playerId を付けて emit する", () => {
    const { session, emit } = setup(makeState(), "alice");
    session.send({ type: "PLACE", index: 4 });
    expect(emit).toHaveBeenCalledWith("action", { type: "PLACE", index: 4, playerId: "alice" });
  });

  it("state.players を持たないゲームでは誰でも isPlayer（着席の概念がない）", () => {
    const { session, emit } = setup(makeState({ players: undefined }), "anyone");
    expect(session.isPlayer.value).toBe(true);
    expect(session.myRole.value).toBeUndefined();
    session.send({ type: "PLACE", index: 0 });
    expect(emit).toHaveBeenCalledTimes(1);
  });

  it("ruleset を省略すると合法手は常に空", () => {
    const props = reactive({ state: makeState(), myPlayerId: "alice" });
    const session = useGameSession(props, vi.fn());
    expect(session.isMyTurn.value).toBe(true);
    expect(session.legalActions.value).toEqual([]);
    expect(session.can(() => true)).toBe(false);
  });

  it("props.state の差し替えに追従する", () => {
    const { props, session } = setup(makeState(), "bob");
    expect(session.isMyTurn.value).toBe(false);
    props.state = makeState({ activePlayers: ["bob"], turn: -1 });
    expect(session.isMyTurn.value).toBe(true);
    expect(session.legalActions.value.length).toBeGreaterThan(0);
  });
});
