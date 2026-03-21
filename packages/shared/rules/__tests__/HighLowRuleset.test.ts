import { expect, test, describe } from "bun:test";
import { HighLowRuleset } from "../HighLowRuleset";

describe("HighLowRuleset", () => {
    test("getInitialState should return correct initial state", () => {
        const state = HighLowRuleset.getInitialState();
        expect(state.status).toBe("WAITING");
        expect(state.deck.length).toBe(0);
        expect(state.currentTurn).toBe(1);
        expect(state.scores).toEqual({ 1: 0, 2: 0 });
    });

    test("isValidAction should validate guessing in turn", () => {
        let state = HighLowRuleset.getInitialState();
        state.players = { 1: "p1", 2: "p2" };
        
        // Cannot guess before START
        expect(HighLowRuleset.isValidAction(state, { type: "GUESS", choice: "HIGH", playerId: "p1" })).toBe(false);
        
        // START is valid in WAITING
        expect(HighLowRuleset.isValidAction(state, { type: "START", playerId: "p1" })).toBe(true);

        // PLAYING state
        state = HighLowRuleset.reduce(state, { type: "START", playerId: "p1" });
        expect(state.status).toBe("PLAYING");
        
        // Only current turn player can guess
        expect(HighLowRuleset.isValidAction(state, { type: "GUESS", choice: "HIGH", playerId: "p1" })).toBe(true);
        expect(HighLowRuleset.isValidAction(state, { type: "GUESS", choice: "HIGH", playerId: "p2" })).toBe(false);
    });

    test("reduce should handle guessing and scoring", () => {
        let state = HighLowRuleset.getInitialState();
        state.players = { 1: "p1", 2: "p2" };
        state = HighLowRuleset.reduce(state, { type: "START", playerId: "p1" });
        
        // Mock current situation
        state.baseCard = { suit: "♠", rank: 7 };
        state.deck = [{ suit: "♥", rank: 10 }]; // Higher than 7
        
        let nextState = HighLowRuleset.reduce(state, { type: "GUESS", choice: "HIGH", playerId: "p1" });
        
        expect(nextState.scores[1]).toBe(1);
        expect(nextState.currentTurn).toBe(2);
        expect(nextState.baseCard.rank).toBe(10);
        expect(nextState.round).toBe(2);
    });

    test("checkWinCondition should detect win by score", () => {
        let state = HighLowRuleset.getInitialState();
        state.scores = { 1: 5, 2: 0 };
        expect(HighLowRuleset.checkWinCondition(state).isFinished).toBe(true);
        expect(HighLowRuleset.checkWinCondition(state).message).toContain("Player 1 Wins");

        state.scores = { 1: 0, 2: 0 };
        state.deck = [];
        expect(HighLowRuleset.checkWinCondition(state).isFinished).toBe(true);
        expect(HighLowRuleset.checkWinCondition(state).message).toContain("Deck out");
    });
});
