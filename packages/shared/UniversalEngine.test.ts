import { expect, test, describe, beforeEach } from "bun:test";
import { UniversalEngine } from "@engine/shared/UniversalEngine";
import {
  type BaseGameState,
  type BaseGameAction,
  type GameRuleset,
  createSecret,
} from "@engine/shared/GameRules";

// Mock types
interface MockState extends BaseGameState {
  count: number;
  secretData?: unknown;
}

interface MockAction extends BaseGameAction {
  type: "INCREMENT" | "SET_SECRET";
  value?: number;
  data?: unknown;
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

  test("getReplayData / loadState でリプレイ情報ごと別エンジンへ引き継げる", () => {
    engine.dispatch({ type: "INCREMENT", value: 1 });
    engine.dispatch({ type: "INCREMENT", value: 2 });
    const original = engine.getGameRecord("g");

    // 履歴だけ渡した場合は初期状態・ハッシュ履歴がこのエンジン生成時のもののまま
    const partial = new UniversalEngine<MockState, MockAction, MockOptions>(mockRules, {
      initialCount: 99,
    });
    partial.loadState(structuredClone(engine.getState()), [...engine.history]);
    expect(partial.getGameRecord("g").initialState.count).toBe(99);

    // リプレイ情報一式を渡せば GameRecord が元のエンジンと一致する
    const restored = new UniversalEngine<MockState, MockAction, MockOptions>(mockRules, {
      initialCount: 99,
    });
    restored.loadState(structuredClone(engine.getState()), structuredClone(engine.getReplayData()));
    expect(restored.getGameRecord("g")).toEqual(original);

    // 引き継いだ後も履歴・ハッシュが続きから積まれる
    restored.dispatch({ type: "INCREMENT", value: 1 });
    const cont = restored.getGameRecord("g");
    expect(cont.actions.length).toBe(3);
    expect(cont.stateHashes?.length).toBe(4);
    expect(cont.initialState.count).toBe(5);
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
    const success = engine.dispatch({ type: "UNKNOWN" as MockAction["type"] });
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
    expect(stateForP1.secretData).toEqual({ nested: "Deep Secret" });

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
        (state as { count: number }).count += 1; // Mutation!
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
});
