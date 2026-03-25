import { describe, it, expect } from "bun:test";
import { movePlayer, Board, BaseBoardState } from "../SugorokuGameEngine";

describe("BoardGameEngine", () => {
  const mockBoard: Board<any> = {
    spaces: [
      { id: "S1", type: "NORMAL", text: "1" },
      { id: "S2", type: "NORMAL", text: "2" },
      { id: "MUST_STOP", type: "STOP", text: "3", mustStop: true },
      { id: "S4", type: "NORMAL", text: "4" },
      { id: "S5", type: "NORMAL", text: "5" },
    ],
    getNextSpaceId: (currentId) => {
      const ids = ["S1", "S2", "MUST_STOP", "S4", "S5"];
      const idx = ids.indexOf(currentId);
      return idx >= 0 && idx < ids.length - 1 ? ids[idx + 1] : null;
    },
  };

  it("should move player multiple steps", () => {
    const initialState: BaseBoardState = {
      status: "PLAYING",
      boardPlayers: {
        P1: { id: "P1", position: "S1", isFinished: false },
      },
      turnOrder: ["P1"],
      currentPlayerIndex: 0,
      activePlayers: ["P1"],
    };

    const newState = movePlayer(initialState, "P1", 1, mockBoard);
    expect(newState.boardPlayers["P1"].position).toBe("S2");
  });

  it("should stop at mustStop spaces", () => {
    const initialState: BaseBoardState = {
      status: "PLAYING",
      boardPlayers: {
        P1: { id: "P1", position: "S1", isFinished: false },
      },
      turnOrder: ["P1"],
      currentPlayerIndex: 0,
      activePlayers: ["P1"],
    };

    // Attempt to move 3 steps from S1 -> S2 -> MUST_STOP -> S4
    // But it should stop at MUST_STOP
    const newState = movePlayer(initialState, "P1", 3, mockBoard);
    expect(newState.boardPlayers["P1"].position).toBe("MUST_STOP");
  });

  it("should apply onPass and onStop hooks", () => {
    let passCount = 0;
    let stopCount = 0;

    const hookedBoard: Board<any> = {
      spaces: [
        { id: "S1", type: "NORMAL", text: "1" },
        {
          id: "S2",
          type: "NORMAL",
          text: "2",
          onPass: (s) => {
            passCount++;
            return s;
          },
          onStop: (s) => {
            stopCount++;
            return s;
          },
        },
        { id: "S3", type: "NORMAL", text: "3" },
      ],
      getNextSpaceId: (id) => (id === "S1" ? "S2" : id === "S2" ? "S3" : null),
    };

    const initialState: BaseBoardState = {
      status: "PLAYING",
      boardPlayers: {
        P1: { id: "P1", position: "S1", isFinished: false },
      },
      turnOrder: ["P1"],
      currentPlayerIndex: 0,
    };

    // Move 2 steps: S1 -> S2 (pass) -> S3 (stop)
    movePlayer(initialState, "P1", 2, hookedBoard);
    expect(passCount).toBe(1);
    expect(stopCount).toBe(0); // S3 doesn't have onStop, S2 was passed.

    // Wait, let's check S3 stop hook
    const hookedBoard2: Board<any> = {
      spaces: [
        { id: "S1", type: "NORMAL", text: "1" },
        {
          id: "S2",
          type: "NORMAL",
          text: "2",
          onPass: (s) => {
            passCount = 10;
            return s;
          },
        },
        {
          id: "S3",
          type: "NORMAL",
          text: "3",
          onStop: (s) => {
            stopCount = 20;
            return s;
          },
        },
      ],
      getNextSpaceId: (id) => (id === "S1" ? "S2" : id === "S2" ? "S3" : null),
    };

    // Reset initialState for second test
    const initialState2: BaseBoardState = {
      status: "PLAYING",
      boardPlayers: {
        P1: { id: "P1", position: "S1", isFinished: false },
      },
      turnOrder: ["P1"],
      currentPlayerIndex: 0,
    };

    movePlayer(initialState2, "P1", 2, hookedBoard2);
    expect(passCount).toBe(10);
    expect(stopCount).toBe(20);
  });
});
