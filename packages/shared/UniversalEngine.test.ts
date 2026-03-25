import { expect, test, describe, beforeEach } from "bun:test";
import { UniversalEngine } from "./UniversalEngine";
import { BaseGameState, BaseGameAction, GameRuleset, createSecret } from "./GameRules";

// Mock types
interface MockState extends BaseGameState {
  count: number;
  secretData?: any;
}

interface MockAction extends BaseGameAction {
  type: "INCREMENT" | "SET_SECRET";
  value?: number;
  data?: any;
}

interface MockOptions {
  initialCount: number;
  clientSeed?: string;
}

// Mock ruleset
const mockRules: GameRuleset<MockState, MockAction, MockOptions> = {
  getInitialState: (options) => ({
    status: "PLAYING",
    version: 0,
    count: options?.initialCount ?? 0,
  }),
  isValidAction: (state, action) => {
    if (action.type === "INCREMENT") return true;
    if (action.type === "SET_SECRET") return true;
    return false;
  },
  reduce: (state, action) => {
    if (action.type === "INCREMENT") {
      return { ...state, count: state.count + (action.value ?? 1) };
    }
    if (action.type === "SET_SECRET") {
      return { ...state, secretData: action.data };
    }
    return state;
  },
  checkWinCondition: (state) => {
    if (state.count >= 10) {
      return { isFinished: true, message: "Reached 10!" };
    }
    return { isFinished: false };
  },
  getLegalActions: (state, playerId) => {
    return [{ type: "INCREMENT", playerId }];
  },
};

describe("UniversalEngine", () => {
  let engine: UniversalEngine<MockState, MockAction, MockOptions>;

  beforeEach(() => {
    engine = new UniversalEngine<MockState, MockAction, MockOptions>(mockRules, {
      initialCount: 5,
    });
  });

  test("should initialize with initial state", () => {
    const state = engine.getState();
    expect(state.count).toBe(5);
    expect(state.status).toBe("PLAYING");
    expect(state.version).toBe(0);
  });

  test("should load state and history", () => {
    const savedState: MockState = { status: "PLAYING", version: 10, count: 20 };
    const history: MockAction[] = [{ type: "INCREMENT", value: 5 }];
    engine.loadState(savedState, history);

    expect(engine.getState().count).toBe(20);
    expect(engine.history.length).toBe(1);
  });

  test("should dispatch actions and update state", () => {
    const success = engine.dispatch({ type: "INCREMENT", value: 2 });
    expect(success).toBe(true);
    expect(engine.getState().count).toBe(7);
    expect(engine.getState().version).toBe(1);
    expect(engine.history.length).toBe(1);
  });

  test("should handle game finish", () => {
    engine.dispatch({ type: "INCREMENT", value: 5 });
    const state = engine.getState();
    expect(state.status).toBe("FINISHED");
    expect(state.message).toBe("Reached 10!");
  });

  test("should reject invalid actions", () => {
    const success = engine.dispatch({ type: "UNKNOWN" as any });
    expect(success).toBe(false);
    expect(engine.getState().count).toBe(5);
  });

  test("should auto-mask secret data", () => {
    const secret = createSecret("Top Secret", ["player1"], "???");
    engine.dispatch({ type: "SET_SECRET", data: secret });

    // Player1 (authorized)
    const stateForP1 = engine.getMaskedState("player1");
    expect(stateForP1.secretData).toBe("Top Secret");

    // Player2 (unauthorized)
    const stateForP2 = engine.getMaskedState("player2");
    expect(stateForP2.secretData).toBe("???");
  });

  test("should handle recursive masking", () => {
    const secret = createSecret(
      {
        nested: createSecret("Deep Secret", ["player1"]),
      },
      ["player1"],
    );

    engine.dispatch({ type: "SET_SECRET", data: secret });

    const stateForP1 = engine.getMaskedState("player1");
    expect(stateForP1.secretData.nested).toBe("Deep Secret");

    const stateForP2 = engine.getMaskedState("player2");
    expect(stateForP2.secretData).toBe("?");
  });

  test("should use custom clone strategy", () => {
    let cloneCount = 0;
    const customStrategy = {
      clone: (state: MockState) => {
        cloneCount++;
        return JSON.parse(JSON.stringify(state));
      },
    };

    const customEngine = new UniversalEngine<MockState, MockAction, MockOptions>(
      mockRules,
      { initialCount: 5 },
      customStrategy,
    );

    // 1. Constructor clones for initialState
    expect(cloneCount).toBe(1);

    // 2. Dispatch clones before reduce
    customEngine.dispatch({ type: "INCREMENT", value: 1 });
    expect(cloneCount).toBe(2);
  });

  test("should throw error if state is mutated in reduce (development mode)", () => {
    const mutatingRules: GameRuleset<MockState, MockAction, MockOptions> = {
      ...mockRules,
      reduce: (state, _action) => {
        (state as any).count += 1; // Mutation!
        return state;
      },
    };

    const engineWithMutatingRules = new UniversalEngine<MockState, MockAction, MockOptions>(
      mutatingRules,
      { initialCount: 5 },
    );

    // In 'test' environment (Bun defaults to 'test'), it should throw
    expect(() => {
      engineWithMutatingRules.dispatch({ type: "INCREMENT" });
    }).toThrow();
  });

  test("should handle tick if defined in rules", () => {
    let tickCount = 0;
    const rulesWithTick: GameRuleset<MockState, MockAction, MockOptions> = {
      ...mockRules,
      tick: (state, dt) => {
        tickCount++;
        return { ...state, count: state.count + dt };
      },
    };

    const engineWithTick = new UniversalEngine<MockState, MockAction, MockOptions>(rulesWithTick, {
      initialCount: 5,
    });

    const success = engineWithTick.tick(10);
    expect(success).toBe(true);
    expect(engineWithTick.getState().count).toBe(15);
    expect(engineWithTick.getState().version).toBe(1);
    expect(tickCount).toBe(1);
  });

  test("should return true on tick even if not defined in rules (now with scheduler/time)", () => {
    const engineWithNoRulesTick = new UniversalEngine<MockState, MockAction, MockOptions>(
      mockRules,
      { initialCount: 5 },
    );
    expect(engineWithNoRulesTick.tick(10)).toBe(true);
    expect(engineWithNoRulesTick.getState().currentTime).toBe(10);
  });

  test("should handle runSimulation", () => {
    const rulesWithTick: GameRuleset<MockState, MockAction, MockOptions> = {
      ...mockRules,
      tick: (state, _dt) => ({ ...state, count: state.count + 1 }),
    };

    const engineWithTick = new UniversalEngine<MockState, MockAction, MockOptions>(rulesWithTick, {
      initialCount: 5,
    });

    engineWithTick.runSimulation(5);
    expect(engineWithTick.getState().count).toBe(10);
    expect(engineWithTick.getState().version).toBe(5);
  });

  test("should handle mutable tickMode without cloning", () => {
    let tickCount = 0;
    const rulesWithMutableTick: GameRuleset<MockState, MockAction, MockOptions> = {
      ...mockRules,
      tickMode: "mutable",
      tick: (state, dt) => {
        tickCount++;
        state.count += dt; // Mutate directly
        return state;
      },
    };

    const engineWithMutableTick = new UniversalEngine<MockState, MockAction, MockOptions>(
      rulesWithMutableTick,
      { initialCount: 5 },
    );

    const success = engineWithMutableTick.tick(10);
    expect(success).toBe(true);
    expect(engineWithMutableTick.getState().count).toBe(15);
    expect(engineWithMutableTick.getState().version).toBe(1);
    expect(tickCount).toBe(1);

    // Dispatch should still work correctly after mutable ticks
    engineWithMutableTick.dispatch({ type: "INCREMENT", value: 5 });
    expect(engineWithMutableTick.getState().count).toBe(20);
    expect(engineWithMutableTick.getState().version).toBe(2);
  });

  test("should handle scheduled actions", () => {
    const engineWithScheduler = new UniversalEngine<MockState, MockAction, MockOptions>(mockRules, {
      initialCount: 5,
    });

    // Schedule an INCREMENT 100ms in the future
    engineWithScheduler.schedule({ type: "INCREMENT", value: 10 }, 100);

    // Initial tick (50ms) - should not trigger
    engineWithScheduler.tick(50);
    expect(engineWithScheduler.getState().count).toBe(5);

    // Second tick (60ms, total 110ms) - should trigger
    engineWithScheduler.tick(60);
    expect(engineWithScheduler.getState().count).toBe(15);
    expect(engineWithScheduler.history.length).toBe(2);
  });

  test("should handle periodic scheduled actions", () => {
    const engineWithScheduler = new UniversalEngine<MockState, MockAction, MockOptions>(mockRules, {
      initialCount: 0,
    });

    // Schedule every 100ms
    engineWithScheduler.schedule({ type: "INCREMENT", value: 1 }, 100, 100);

    engineWithScheduler.tick(150); // First trigger (total 150)
    expect(engineWithScheduler.getState().count).toBe(1);

    engineWithScheduler.tick(100); // Second trigger (total 250)
    expect(engineWithScheduler.getState().count).toBe(2);

    engineWithScheduler.tick(40); // No trigger (total 290)
    expect(engineWithScheduler.getState().count).toBe(2);

    engineWithScheduler.tick(10); // Third trigger (total 300)
    expect(engineWithScheduler.getState().count).toBe(3);
  });
});
