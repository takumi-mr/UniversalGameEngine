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
    }
};

describe("UniversalEngine", () => {
    let engine: UniversalEngine<MockState, MockAction, MockOptions>;

    beforeEach(() => {
        engine = new UniversalEngine<MockState, MockAction, MockOptions>(mockRules, { initialCount: 5 });
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
        const secret = createSecret({
            nested: createSecret("Deep Secret", ["player1"])
        }, ["player1"]);

        engine.dispatch({ type: "SET_SECRET", data: secret });

        const stateForP1 = engine.getMaskedState("player1");
        expect(stateForP1.secretData.nested).toBe("Deep Secret");

        const stateForP2 = engine.getMaskedState("player2");
        expect(stateForP2.secretData).toBe("?");
    });
});
