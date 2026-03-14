// packages/shared/GameRegistry.ts
import type { GameRuleset, BaseGameState, BaseGameAction } from './UniversalEngine';
import { TicTacToeRuleset } from './rules/TicTacToeRuleset';
import { ChessRuleset } from './rules/ChessRuleset';
import { ShogiRuleset } from './rules/ShogiRuleset';
import { OthelloRuleset } from './rules/OthelloRuleset';
import { Othello3DRuleset } from './rules/Othello3DRuleset';
import { HighLowRuleset } from './rules/HighLowRuleset';
import { TexasHoldemRuleset } from './rules/TexasHoldemRuleset';
import { MahjongRuleset } from './rules/mahjong/MahjongRuleset';
import { DaifugoRuleset } from './rules/DaifugoRuleset';
import { RubiksRuleset } from './rules/RubicCubeRuleset';
import { GoRuleset } from './rules/GoRuleset';
import { EquilibriumRuleset } from './rules/EquilibriumRuleset';

export interface GameDefinition<TState extends BaseGameState, TAction extends BaseGameAction> {
    type: string;
    name: string;
    ruleset: GameRuleset<TState, TAction>;
    minPlayers: number;
    maxPlayers: number;
    description: string;
    emoji: string;
}

class GameRegistry {
    private games = new Map<string, GameDefinition<any, any>>();

    constructor() {
        this.register({
            type: 'othello_3d',
            name: '3D Othello',
            ruleset: Othello3DRuleset,
            minPlayers: 2,
            maxPlayers: 2,
            description: '3D立体オセロ。26方向に挟める！',
            emoji: '🟦',
        });
        this.register({
            type: 'othello',
            name: 'Othello',
            ruleset: OthelloRuleset,
            minPlayers: 2,
            maxPlayers: 2,
            description: '古典的な2Dオセロ（リバーシ）。',
            emoji: '⚫',
        });
        this.register({
            type: 'chess',
            name: 'Chess',
            ruleset: ChessRuleset,
            minPlayers: 2,
            maxPlayers: 2,
            description: '古典的なチェス。',
            emoji: '♔',
        })
        this.register({
            type: 'high-low',
            name: 'High-Low Card',
            ruleset: HighLowRuleset,
            minPlayers: 1,
            maxPlayers: 2,
            description: '引いたカードの強さで競うカードゲーム。',
            emoji: '🃏',
        });
        this.register({
            type: 'texas-holdem',
            name: 'Texas Hold\'em',
            ruleset: TexasHoldemRuleset,
            minPlayers: 2,
            maxPlayers: 6,
            description: 'テキサスホールデムポーカー。',
            emoji: '🂡',
        });
        this.register({
            type: 'mahjong',
            name: 'Mahjong',
            ruleset: MahjongRuleset,
            minPlayers: 4,
            maxPlayers: 4,
            description: '4人麻雀。役・符・点数計算対応。',
            emoji: '🀄',
        });
        this.register({
            type: 'daifugo',
            name: '大富豪',
            ruleset: DaifugoRuleset,
            minPlayers: 2,
            maxPlayers: 4,
            description: '大富豪（ジョーカー入り54枚）。',
            emoji: '👑',
        });
        this.register({
            type: 'go',
            name: 'Go',
            ruleset: GoRuleset,
            minPlayers: 2,
            maxPlayers: 2,
            description: '囲碁 (9x9, 13x13, 19x19)。Tromp-Taylor集計対応。',
            emoji: '⚪',
        });
        this.register({
            type: 'rubiks_cube',
            name: "Rubik's Cube",
            ruleset: RubiksRuleset,
            minPlayers: 1,
            maxPlayers: 1,
            description: '1人用ルービックキューブ。',
            emoji: '🟥',
        });
        this.register({
            type: 'tictactoe',
            name: 'Tic Tac Toe',
            ruleset: TicTacToeRuleset,
            minPlayers: 2,
            maxPlayers: 2,
            description: '古典的な三目並べ。',
            emoji: '⭕',
        });
        this.register({
            type: 'shogi',
            name: 'Shogi',
            ruleset: ShogiRuleset,
            minPlayers: 2,
            maxPlayers: 2,
            description: '古典的な将棋。',
            emoji: '☗',
        })
        this.register({
            type: 'equilibrium',
            name: 'Equilibrium',
            ruleset: EquilibriumRuleset,
            minPlayers: 2,
            maxPlayers: 2,
            description: 'AIが考案した、魂を削り合う究極の心理戦ボードゲーム。',
            emoji: '⚖️',
        });
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
        return Array.from(this.games.values()).map(g => ({
            type: g.type,
            name: g.name,
            description: g.description,
            emoji: g.emoji,
            minPlayers: g.minPlayers,
            maxPlayers: g.maxPlayers,
        }));
    }
}

export const gameRegistry = new GameRegistry();