import { expect, test, describe } from "bun:test";
import { OthelloRuleset } from "../OthelloRuleset";

describe("OthelloRuleset", () => {
    test("getInitialState should return correct 8x8 initial state", () => {
        const state = OthelloRuleset.getInitialState();
        expect(state.size).toBe(8);
        expect(state.board[3][3]).toBe(-1);
        expect(state.board[3][4]).toBe(1);
        expect(state.board[4][3]).toBe(1);
        expect(state.board[4][4]).toBe(-1);
        expect(state.scores).toEqual({ 1: 2, [-1]: 2 });
    });

    test("isValidAction should check legal othello moves", () => {
        const state = OthelloRuleset.getInitialState();
        state.status = "PLAYING";
        state.players = { 1: "p1", [-1]: "p2" };

        // Black (1) initial legal move at (3, 2)
        expect(OthelloRuleset.isValidAction(state, { type: "PLACE_PIECE", x: 3, y: 2, color: 1, playerId: "p1" })).toBe(true);

        // Invalid: piece already exists
        expect(OthelloRuleset.isValidAction(state, { type: "PLACE_PIECE", x: 3, y: 3, color: 1, playerId: "p1" })).toBe(false);

        // Invalid: no pieces to flip
        expect(OthelloRuleset.isValidAction(state, { type: "PLACE_PIECE", x: 0, y: 0, color: 1, playerId: "p1" })).toBe(false);

        // Invalid: wrong turn
        expect(OthelloRuleset.isValidAction(state, { type: "PLACE_PIECE", x: 3, y: 2, color: -1, playerId: "p2" })).toBe(false);
    });

    test("reduce should flip pieces correctly", () => {
        const state = OthelloRuleset.getInitialState();
        state.status = "PLAYING";

        // Black moves to (3, 2)
        const nextState = OthelloRuleset.reduce(state, { type: "PLACE_PIECE", x: 3, y: 2, color: 1 });
        expect(nextState.board[2][3]).toBe(1); // New piece
        expect(nextState.board[3][3]).toBe(1); // Flipped from -1 to 1
        expect(nextState.scores[1]).toBe(4);
        expect(nextState.scores[-1]).toBe(1);
        expect(nextState.currentTurn).toBe(-1);
    });

    test("getLegalActions should return all valid moves", () => {
        const state = OthelloRuleset.getInitialState();
        state.status = "PLAYING";
        state.players = { 1: "p1", [-1]: "p2" };

        const actions = OthelloRuleset.getLegalActions(state, "p1");
        // Initial black moves: (3,2), (2,3), (5,4), (4,5)
        expect(actions.length).toBe(4);
        expect(actions.map(a => ({ x: a.x, y: a.y }))).toContainValues([
            { x: 3, y: 2 }, { x: 2, y: 3 }, { x: 5, y: 4 }, { x: 4, y: 5 }
        ]);
    });
});
