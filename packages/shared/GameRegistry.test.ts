import { expect, test, describe } from "bun:test";
import { gameRegistry } from "./GameRegistry";

describe("GameRegistry", () => {
    test("should have registered games", () => {
        const definitions = gameRegistry.getAllDefinitions();
        expect(definitions.length).toBeGreaterThan(0);
        
        const types = definitions.map(d => d.type);
        expect(types).toContain("tictactoe");
        expect(types).toContain("othello");
        expect(types).toContain("shogi");
    });

    test("getDefinition should return correct game properties", () => {
        const def = gameRegistry.getDefinition("tictactoe");
        expect(def).toBeDefined();
        expect(def?.name).toBe("Tic Tac Toe");
        expect(def?.ruleset).toBeDefined();
        expect(def?.minPlayers).toBe(2);
        expect(def?.maxPlayers).toBe(2);
    });

    test("getDefinition should return undefined for unknown game", () => {
        const def = gameRegistry.getDefinition("unknown_game");
        expect(def).toBeUndefined();
    });
});
