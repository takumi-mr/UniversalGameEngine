import { expect, test, describe, beforeEach } from "bun:test";
import { MinesweeperRuleset } from "../MinesweeperRuleset";

describe("MinesweeperRuleset", () => {
    test("getInitialState should return correct initial state", () => {
        const state = MinesweeperRuleset.getInitialState({ rows: 5, cols: 5, mineCount: 3 });
        expect(state.status).toBe("WAITING");
        expect(state.board.length).toBe(5);
        expect(state.board[0].length).toBe(5);
        expect(state.mineCount).toBe(3);
        expect(state.isInitialized).toBe(false);
        // All cells should be hidden
        expect(state.board[0][0].secret.visibleTo).toEqual([]);
    });

    test("First REVEAL should initialize mines correctly", () => {
        let state = MinesweeperRuleset.getInitialState({ rows: 3, cols: 3, mineCount: 1 });
        state.status = "PLAYING";
        
        // Reveal (1, 1)
        const nextState = MinesweeperRuleset.reduce(state, { type: "REVEAL", row: 1, col: 1, playerId: "p1" });
        
        expect(nextState.isInitialized).toBe(true);
        expect(nextState.board[1][1].isRevealed).toBe(true);
        expect(nextState.board[1][1].secret.visibleTo).toEqual(['*']);
        expect(nextState.board[1][1].secret.value.isMine).toBe(false); // First move safety
        
        // Check if exactly one mine is placed elsewhere
        let mineCount = 0;
        for (let r = 0; r < 3; r++) {
            for (let c = 0; c < 3; c++) {
                if (nextState.board[r][c].secret.value.isMine) mineCount++;
            }
        }
        expect(mineCount).toBe(1);
    });

    test("Recursive reveal should work for 0 neighbor mines", () => {
        let state = MinesweeperRuleset.getInitialState({ rows: 3, cols: 3, mineCount: 0 });
        state.status = "PLAYING";
        
        // Reveal (1, 1). Since there are no mines, it should reveal everything.
        const nextState = MinesweeperRuleset.reduce(state, { type: "REVEAL", row: 1, col: 1, playerId: "p1" });
        
        for (let r = 0; r < 3; r++) {
            for (let c = 0; c < 3; c++) {
                expect(nextState.board[r][c].isRevealed).toBe(true);
                expect(nextState.board[r][c].secret.visibleTo).toEqual(['*']);
            }
        }
    });

    test("FLAG should toggle isFlagged", () => {
        let state = MinesweeperRuleset.getInitialState({ rows: 3, cols: 3, mineCount: 1 });
        state.status = "PLAYING";
        
        let nextState = MinesweeperRuleset.reduce(state, { type: "FLAG", row: 0, col: 0, playerId: "p1" });
        expect(nextState.board[0][0].isFlagged).toBe(true);
        
        nextState = MinesweeperRuleset.reduce(nextState, { type: "FLAG", row: 0, col: 0, playerId: "p1" });
        expect(nextState.board[0][0].isFlagged).toBe(false);
    });

    test("Hit a mine should result in loss", () => {
        let state = MinesweeperRuleset.getInitialState({ rows: 3, cols: 3, mineCount: 7 }); // 7 mines in 3x3
        state.status = "PLAYING";
        
        // First move at (0, 0)
        let nextState = MinesweeperRuleset.reduce(state, { type: "REVEAL", row: 0, col: 0, playerId: "p1" });
        
        // Since there are 8 mines and only 9 cells, and (0, 0) is safe, every other cell MUST be a mine.
        const result = MinesweeperRuleset.checkWinCondition(nextState);
        expect(result.isFinished).toBe(false);
        
        // Find a mine cell
        let mineRow = -1, mineCol = -1;
        for (let r = 0; r < 3; r++) {
            for (let c = 0; c < 3; c++) {
                if (nextState.board[r][c].secret.value.isMine) {
                    mineRow = r;
                    mineCol = c;
                    break;
                }
            }
        }
        
        // Reveal a mine
        const lostState = MinesweeperRuleset.reduce(nextState, { type: "REVEAL", row: mineRow, col: mineCol, playerId: "p1" });
        const finalResult = MinesweeperRuleset.checkWinCondition(lostState);
        expect(finalResult.isFinished).toBe(true);
        expect(finalResult.winnerIds).toEqual([]);
        expect(finalResult.message).toBe("Game Over! You hit a mine.");

        // Apply result should reveal all mines
        const finishedState = MinesweeperRuleset.applyWinResult!(lostState, finalResult);
        expect(finishedState.status).toBe("FINISHED");
        for (let r = 0; r < 3; r++) {
            for (let c = 0; c < 3; c++) {
                if (finishedState.board[r][c].secret.value.isMine) {
                    expect(finishedState.board[r][c].isRevealed).toBe(true);
                    expect(finishedState.board[r][c].secret.visibleTo).toEqual(['*']);
                }
            }
        }
    });

    test("Clear all mines should result in win", () => {
        let state = MinesweeperRuleset.getInitialState({ rows: 3, cols: 3, mineCount: 8 });
        state.status = "PLAYING";
        state.players = { 1: "p1" };
        
        // First move at (0, 0) reveals the only non-mine cell
        let nextState = MinesweeperRuleset.reduce(state, { type: "REVEAL", row: 0, col: 0, playerId: "p1" });
        
        const result = MinesweeperRuleset.checkWinCondition(nextState);
        expect(result.isFinished).toBe(true);
        expect(result.winnerIds).toEqual(["p1"]);
    });
});
