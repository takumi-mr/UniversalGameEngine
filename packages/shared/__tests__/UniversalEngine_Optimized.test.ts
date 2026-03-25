import { expect, test, describe } from "bun:test";
import { UniversalEngine, UniversalEngineOptions } from "../UniversalEngine";
import { BaseGameState, BaseGameAction, GameRuleset } from "../GameRules";
import { ReplayEngine } from "../ReplayEngine";

// Mock types
interface MockState extends BaseGameState {
  count: number;
}

interface MockAction extends BaseGameAction {
  type: "INCREMENT";
}

const mockRules: GameRuleset<MockState, MockAction, any> = {
  getInitialState: () => ({ status: "PLAYING", version: 0, count: 0 }),
  isValidAction: () => true,
  reduce: (state) => ({ ...state, count: state.count + 1 }),
  checkWinCondition: (state) =>
    state.count >= 10 ? { isFinished: true, message: "Done" } : { isFinished: false },
  getLegalActions: () => [{ type: "INCREMENT" }],
};

describe("UniversalEngine Optimization", () => {
  test("should skip hashing when autoHash is false", () => {
    const engine = new UniversalEngine<MockState, MockAction, UniversalEngineOptions>(mockRules, {
      autoHash: false,
    });

    engine.dispatch({ type: "INCREMENT" });
    expect(engine.getState().hash).toBeUndefined();

    engine.computeHash();
    expect(engine.getState().hash).toBeDefined();
  });

  test("should hash at intervals", () => {
    const engine = new UniversalEngine<MockState, MockAction, UniversalEngineOptions>(mockRules, {
      autoHash: true,
      hashInterval: 3,
    });

    engine.dispatch({ type: "INCREMENT" }); // v1
    expect(engine.getState().hash).toBeUndefined();

    engine.dispatch({ type: "INCREMENT" }); // v2
    expect(engine.getState().hash).toBeUndefined();

    engine.dispatch({ type: "INCREMENT" }); // v3
    expect(engine.getState().hash).toBeDefined();
  });

  test("should hash when game finishes even if autoHash is false", () => {
    const engine = new UniversalEngine<MockState, MockAction, UniversalEngineOptions>(mockRules, {
      autoHash: false,
    });

    for (let i = 0; i < 9; i++) engine.dispatch({ type: "INCREMENT" });
    expect(engine.getState().hash).toBeUndefined();

    engine.dispatch({ type: "INCREMENT" }); // 10th - Finished
    expect(engine.getState().status).toBe("FINISHED");
    expect(engine.getState().hash).toBeDefined();
  });

  test("should take snapshot and clear history when maxHistorySize reached", () => {
    const engine = new UniversalEngine<MockState, MockAction, UniversalEngineOptions>(mockRules, {
      maxHistorySize: 3,
    });

    engine.dispatch({ type: "INCREMENT" }); // v1, history [1]
    engine.dispatch({ type: "INCREMENT" }); // v2, history [1, 2]

    expect(engine.history.length).toBe(2);

    engine.dispatch({ type: "INCREMENT" }); // v3, history reaches 3 -> snapshot -> cleared

    expect(engine.history.length).toBe(0);
    const record = engine.getGameRecord("test");
    expect(record.snapshotState).toBeDefined();
    expect(record.snapshotState?.count).toBe(3);
    expect(record.snapshotVersion).toBe(3);
  });

  test("should support loading state with history and maintain snapshot consistency", () => {
    const engine = new UniversalEngine<MockState, MockAction, UniversalEngineOptions>(mockRules, {
      maxHistorySize: 10,
    });

    const savedState: MockState = { status: "PLAYING", version: 5, count: 5 };
    const history: MockAction[] = [{ type: "INCREMENT" }, { type: "INCREMENT" }]; // actions since version 3

    engine.loadState(savedState, history);

    // snapshotVersion should be 5 - 2 = 3
    // because current version is 5 and there are 2 actions in history
    const record = engine.getGameRecord("test");
    expect(record.snapshotVersion).toBe(3);
  });

  test("should replay from a snapshot in ReplayEngine", () => {
    const engine = new UniversalEngine<MockState, MockAction, UniversalEngineOptions>(mockRules, {
      maxHistorySize: 3,
    });

    for (let i = 0; i < 3; i++) engine.dispatch({ type: "INCREMENT" }); // reaches 3, snapshot
    for (let i = 0; i < 2; i++) engine.dispatch({ type: "INCREMENT" }); // version 5

    const record = engine.getGameRecord("replay-snapshot");
    expect(record.snapshotState).toBeDefined();
    expect(record.actions.length).toBe(2);

    const replayEngine = new ReplayEngine(mockRules, record);
    const success = replayEngine.verify(record);

    expect(success).toBe(true);
    expect(replayEngine.getState().count).toBe(5);
  });
});
