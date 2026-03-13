// packages/shared/GameRegistry.ts
import type { GameRuleset, BaseGameState, BaseGameAction } from './UniversalEngine';
import { OthelloRuleset } from './rules/OthelloRules';
import { Othello3DRuleset } from './rules/Othello3DRules';
// 将来的に import { ShogiRuleset } from './rules/ShogiRuleset'; などが増える

export interface GameDefinition<TState extends BaseGameState, TAction extends BaseGameAction> {
    type: string;
    name: string;
    ruleset: GameRuleset<TState, TAction>;
}

class GameRegistry {
    private games = new Map<string, GameDefinition<any, any>>();

    constructor() {
        // ここにゲームを登録していく
        this.register({
            type: 'othello-3d',
            name: '3D Othello',
            ruleset: Othello3DRuleset
        });
        this.register({
            type: 'othello',
            name: 'Othello',
            ruleset: OthelloRuleset
        })
    }

    register<TState extends BaseGameState, TAction extends BaseGameAction>(
        def: GameDefinition<TState, TAction>
    ) {
        this.games.set(def.type, def);
    }

    getDefinition(type: string): GameDefinition<any, any> | undefined {
        return this.games.get(type);
    }

    getAllDefinitions() {
        return Array.from(this.games.values()).map(g => ({ type: g.type, name: g.name }));
    }
}

export const gameRegistry = new GameRegistry();