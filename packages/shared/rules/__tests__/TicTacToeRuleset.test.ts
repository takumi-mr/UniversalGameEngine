import { expect, test, describe, beforeEach } from "bun:test";
import { TicTacToeRuleset } from "../TicTacToeRuleset";

describe("TicTacToeRuleset", () => {
    test("getInitialState should return correct initial state", () => {
        const state = TicTacToeRuleset.getInitialState();
        expect(state.status).toBe("WAITING");
        expect(state.board).toEqual(Array(9).fill(0));
        expect(state.turn).toBe(1);
    });

    test("isValidAction should validate correctly", () => {
        let state = TicTacToeRuleset.getInitialState();
        state.status = "PLAYING";
        state.players = { 1: "p1", "-1": "p2" };

        // Valid move
        expect(TicTacToeRuleset.isValidAction(state, { type: "PLACE", index: 0, playerId: "p1" })).toBe(true);

        // Wrong player
        expect(TicTacToeRuleset.isValidAction(state, { type: "PLACE", index: 0, playerId: "p2" })).toBe(false);

        // Out of bounds
        expect(TicTacToeRuleset.isValidAction(state, { type: "PLACE", index: 9, playerId: "p1" })).toBe(false);

        // Already occupied
        state.board[0] = 1;
        expect(TicTacToeRuleset.isValidAction(state, { type: "PLACE", index: 0, playerId: "p1" })).toBe(false);
    });

    test("reduce should update board and turn", () => {
        let state = TicTacToeRuleset.getInitialState();
        state.status = "PLAYING";
        state.players = { 1: "p1", "-1": "p2" };

        const nextState = TicTacToeRuleset.reduce(state, { type: "PLACE", index: 4, playerId: "p1" });
        expect(nextState.board[4]).toBe(1);
        expect(nextState.turn).toBe(-1);
        expect(nextState.activePlayers).toEqual(["p2"]);
    });

    test("checkWinCondition should detect wins and draws", () => {
        // Horizontal win
        let state = TicTacToeRuleset.getInitialState();
        state.board = [1, 1, 1, 0, 0, 0, 0, 0, 0];
        expect(TicTacToeRuleset.checkWinCondition(state)).toEqual({ isFinished: true, message: "O Wins", winnerIds: ["1"] });

        // Vertical win
        state.board = [-1, 0, 0, -1, 0, 0, -1, 0, 0];
        expect(TicTacToeRuleset.checkWinCondition(state)).toEqual({ isFinished: true, message: "X Wins", winnerIds: ["-1"] });

        // Diagonal win
        state.board = [1, 0, 0, 0, 1, 0, 0, 0, 1];
        expect(TicTacToeRuleset.checkWinCondition(state)).toEqual({ isFinished: true, message: "O Wins", winnerIds: ["1"] });

        // Draw
        state.board = [
            1, -1, 1,
            1, -1, 1,
            -1, 1, -1
        ];
        expect(TicTacToeRuleset.checkWinCondition(state)).toEqual({ isFinished: true, message: "Draw", winnerIds: [] });

        // Ongoing
        state.board = [1, -1, 1, 0, 0, 0, 0, 0, 0];
        expect(TicTacToeRuleset.checkWinCondition(state)).toEqual({ isFinished: false });
    });

    test("getLegalActions should return all empty spots", () => {
        let state = TicTacToeRuleset.getInitialState();
        state.status = "PLAYING";
        state.players = { 1: "p1", "-1": "p2" };
        state.board = [1, -1, 1, 0, 0, 0, 0, 0, 0];

        const actions = TicTacToeRuleset.getLegalActions(state, "p1");
        expect(actions.length).toBe(6);
        expect(actions.every(a => a.type === "PLACE")).toBe(true);
        expect(actions.map(a => a.index)).toEqual([3, 4, 5, 6, 7, 8]);
    });
});
