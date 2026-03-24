import { expect, test, describe } from "bun:test";
import { UniversalEngine } from "./UniversalEngine";
import { ReplayEngine } from "./ReplayEngine";
import { BaseGameState, BaseGameAction, GameRuleset } from "./GameRules";

interface MockState extends BaseGameState {
  count: number;
}

interface MockAction extends BaseGameAction {
  type: "INCREMENT";
  value?: number;
}

const mockRules: GameRuleset<MockState, MockAction, { initial: number }> = {
  getInitialState: (options) => ({
    status: "PLAYING",
    version: 0,
    count: options?.initial ?? 0,
  }),
  isValidAction: () => true,
  reduce: (state, action) => ({
    ...state,
    count: state.count + (action.value ?? 1),
  }),
  checkWinCondition: (state) => ({ isFinished: state.count >= 10 }),
  getLegalActions: () => [],
};

describe("Replay System", () => {
  test("should record and replay a game session perfectly", () => {
    const engine = new UniversalEngine(mockRules, { initial: 0 });

    // Play the game
    engine.dispatch({ type: "INCREMENT", value: 2 });
    engine.dispatch({ type: "INCREMENT", value: 3 });
    engine.dispatch({ type: "INCREMENT", value: 5 }); // Total 10 -> Finished

    const record = engine.getGameRecord("test-game-1");

    expect(record.actions.length).toBe(3);
    expect(record.stateHashes?.length).toBe(4); // initial + 3 actions
    expect(record.initialState.count).toBe(0);

    // Replay
    const replayEngine = new ReplayEngine(mockRules, record);
    const success = replayEngine.verify(record);

    expect(success).toBe(true);
    expect(replayEngine.getState().count).toBe(10);
    expect(replayEngine.getState().status).toBe("FINISHED");
  });

  test("should detect tampered actions", () => {
    const engine = new UniversalEngine(mockRules, { initial: 0 });
    engine.dispatch({ type: "INCREMENT", value: 1 });

    const record = engine.getGameRecord("test-game-2");

    // Tamper with actions: change value from 1 to 2
    record.actions[0].value = 2;

    const replayEngine = new ReplayEngine(mockRules, record);

    // Should throw hash mismatch error
    expect(() => replayEngine.verify(record)).toThrow(/Hash mismatch/);
  });

  test("should handle RNG consistency (Provably Fair)", () => {
    const rulesWithRNG: GameRuleset<MockState, MockAction, any> = {
      ...mockRules,
      reduce: (state, action, rng) => {
        const roll = rng ? rng.nextInt(1, 10) : 1;
        return {
          ...state,
          count: state.count + roll,
        };
      },
    };

    const clientSeed = "client-seed-123";
    const serverSeed = "server-seed-456";

    const engine = new UniversalEngine(rulesWithRNG, { clientSeed, serverSeed });
    engine.dispatch({ type: "INCREMENT" });
    engine.dispatch({ type: "INCREMENT" });

    const record = engine.getGameRecord("rng-game");

    // Replay
    const replayEngine = new ReplayEngine(rulesWithRNG, record);
    const success = replayEngine.verify(record);

    expect(success).toBe(true);
    expect(replayEngine.getState().count).toBe(engine.getState().count);
  });
});
