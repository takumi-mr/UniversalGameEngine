import { expect, test, describe, beforeEach } from "bun:test";
import { HighLowRuleset, Card } from "../HighLowRuleset";

describe("HighLowRuleset", () => {
    test("getInitialState should return correct initial state", () => {
        const state = HighLowRuleset.getInitialState();
        expect(state.status).toBe("WAITING");
        expect(state.deck.length).toBe(52);
        expect(state.currentTurn).toBe(1);
        expect(state.scores).toEqual({ 1: 0, 2: 0 });
    });

    test("isValidAction should validate drawing in turn", () => {
        const state = HighLowRuleset.getInitialState();
        state.status = "PLAYING";
        
        expect(HighLowRuleset.isValidAction(state, { type: "DRAW", player: 1 })).toBe(true);
        expect(HighLowRuleset.isValidAction(state, { type: "DRAW", player: 2 })).toBe(false);
    });

    test("reduce should handle drawing and scoring", () => {
        let state = HighLowRuleset.getInitialState();
        state.status = "PLAYING";
        
        // P1 draws K(13)
        state.deck = [{ suit: "♠", rank: 13 }];
        let nextState = HighLowRuleset.reduce(state, { type: "DRAW", player: 1 });
        expect(nextState.field[1]?.rank).toBe(13);
        expect(nextState.currentTurn).toBe(2);

        // P2 draws A(1)
        nextState.deck = [{ suit: "♠", rank: 1 }];
        nextState = HighLowRuleset.reduce(nextState, { type: "DRAW", player: 2 });
        
        // Round ends, P1 wins round
        expect(nextState.scores[1]).toBe(1);
        expect(nextState.scores[2]).toBe(0);
        expect(nextState.round).toBe(2);
        expect(nextState.field[1]).toBeNull();
        expect(nextState.currentTurn).toBe(1);
    });

    test("checkWinCondition should detect match end", () => {
        let state = HighLowRuleset.getInitialState();
        state.scores = { 1: 3, 2: 0 };
        expect(HighLowRuleset.checkWinCondition(state)).toEqual({ isFinished: true, message: "Game Over: Player 1 Wins the Match!" });

        state.scores = { 1: 0, 2: 0 };
        state.deck = [];
        expect(HighLowRuleset.checkWinCondition(state)).toEqual({ isFinished: true, message: "Game Over: Deck Out, Draw Game!" });
    });
});
