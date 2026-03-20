// packages/shared/GameRegistry.ts
import type { GameRuleset, BaseGameState, BaseGameAction } from './GameRules';
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
import { UnoRuleset } from './rules/UnoRuleset';
import { SudokuRuleset } from './rules/SudokuRuleset';
import { MancalaRuleset } from './rules/MancalaRuleset';
import { WordleRuleset } from './rules/WordleRuleset';
import { SpeedRuleset } from './rules/SpeedRuleset';
import { MinesweeperRuleset } from './rules/MinesweeperRuleset';

export interface GameDefinition<TState extends BaseGameState, TAction extends BaseGameAction> {
    type: string;
    name: string;
    ruleset: GameRuleset<TState, TAction>;
    minPlayers: number;
    maxPlayers: number;
    description: string;
    emoji: string;
    rules?: string;
}

class GameRegistry {
    private games = new Map<string, GameDefinition<any, any>>();

    constructor() {
        this.register({
            type: 'minesweeper',
            name: 'Minesweeper',
            ruleset: MinesweeperRuleset,
            minPlayers: 1,
            maxPlayers: 1,
            description: '古典的なマインスイーパー。地雷を避けて全ての安全なマスを開けよう。',
            emoji: '💣',
            rules: '数字をヒントに地雷がないマスを開けていくパズルゲームです。全ての安全なマスを開けるとクリア、地雷を開けるとゲームオーバーです。',
        });
        this.register({
            type: 'othello_3d',
            name: '3D Othello',
            ruleset: Othello3DRuleset,
            minPlayers: 2,
            maxPlayers: 2,
            description: '3D立体オセロ。26方向に挟める！',
            emoji: '🟦',
            rules: '石を置いて、上下左右、斜めに加えて、高さ（Z軸）方向も含む26方向に相手の石を挟んで自分の色に変えます。',
        });
        this.register({
            type: 'othello',
            name: 'Othello',
            ruleset: OthelloRuleset,
            minPlayers: 2,
            maxPlayers: 2,
            description: '古典的な2Dオセロ（リバーシ）。',
            emoji: '⚫',
            rules: '相手の石を挟んで自分の色に変える、伝統的なボードゲームです。最後に石が多いほうが勝ち。',
        });
        this.register({
            type: 'chess',
            name: 'Chess',
            ruleset: ChessRuleset,
            minPlayers: 2,
            maxPlayers: 2,
            description: '古典的なチェス。',
            emoji: '♔',
            rules: 'キング、クイーン、ルーク、ビショップ、ナイト、ポーンを動かして、相手のキングをチェックメイトします。',
        })
        this.register({
            type: 'chess_3d',
            name: 'Chess 3D',
            ruleset: ChessRuleset,
            minPlayers: 2,
            maxPlayers: 2,
            description: '3Dチェス。',
            emoji: '♔',
            rules: 'キング、クイーン、ルーク、ビショップ、ナイト、ポーンを動かして、相手のキングをチェックメイトします。',
        })
        this.register({
            type: 'shogi_3d',
            name: 'Shogi 3D',
            ruleset: ShogiRuleset,
            minPlayers: 2,
            maxPlayers: 2,
            description: '3D将棋。',
            emoji: '☖',
            rules: '自分の駒を動かして相手の玉将を詰ませます。相手から取った駒を自分の持ち駒として使うことができます。',
        })
        this.register({
            type: 'high_low',
            name: 'High-Low Card',
            ruleset: HighLowRuleset,
            minPlayers: 1,
            maxPlayers: 2,
            description: '引いたカードの強さで競うカードゲーム。',
            emoji: '🃏',
            rules: '次に引くカードが現在のカードより「高い」か「低い」かを予想します。',
        });
        this.register({
            type: 'uno',
            name: 'UNO',
            ruleset: UnoRuleset,
            minPlayers: 2,
            maxPlayers: 10,
            description: 'UNO。',
            emoji: '🃏',
            rules: '同じ色か同じ数字のカードを出していき、最初に手札がなくなった人の勝ちです。',
        })
        this.register({
            type: 'texas_holdem',
            name: 'Texas Hold\'em',
            ruleset: TexasHoldemRuleset,
            minPlayers: 2,
            maxPlayers: 6,
            description: 'テキサスホールデムポーカー。',
            emoji: '🂡',
            rules: '2枚の手札と5枚の共通カードを組み合わせて最強の役を作ります。',
        });
        this.register({
            type: 'mahjong',
            name: 'Mahjong',
            ruleset: MahjongRuleset,
            minPlayers: 4,
            maxPlayers: 4,
            description: '4人麻雀。役・符・点数計算対応。',
            emoji: '🀄',
            rules: '4つの面子（メンツ）と1つの雀頭（ジャントウ）を揃えて和了（あがり）を目指します。',
        });
        this.register({
            type: 'daifugo',
            name: '大富豪',
            ruleset: DaifugoRuleset,
            minPlayers: 2,
            maxPlayers: 4,
            description: '大富豪（ジョーカー入り54枚）。',
            emoji: '👑',
            rules: '手札を早く出し切り、大富豪を目指すトランプゲームです。革命や階段などの独自ルールもあります。',
        });
        this.register({
            type: 'go',
            name: 'Go',
            ruleset: GoRuleset,
            minPlayers: 2,
            maxPlayers: 2,
            description: '囲碁 (9x9, 13x13, 19x19)。Tromp-Taylor集計対応。',
            emoji: '⚪',
            rules: '石で盤面の囲いを広げ、陣地の広さを競います。',
        });
        this.register({
            type: 'rubiks_cube',
            name: "Rubik's Cube",
            ruleset: RubiksRuleset,
            minPlayers: 1,
            maxPlayers: 1,
            description: '1人用ルービックキューブ。',
            emoji: '🟥',
            rules: '6つの面の各色を揃える立体パズルです。',
        });
        this.register({
            type: 'sudoku',
            name: 'Sudoku',
            ruleset: new SudokuRuleset(),
            minPlayers: 1,
            maxPlayers: 1,
            description: '古典的な数独パズル。',
            emoji: '🔢',
            rules: '9x9のマス目に1から9の数字を、各行、各列、3x3のブロックで重複しないように配置します。',
        });
        this.register({
            type: 'tictactoe',
            name: 'Tic Tac Toe',
            ruleset: TicTacToeRuleset,
            minPlayers: 2,
            maxPlayers: 2,
            description: '古典的な三目並べ。',
            emoji: '⭕',
            rules: '3x3のマス目に○と×を交互に書き、3つ並べたほうが勝ちというシンプルなゲーム。',
        });
        this.register({
            type: 'shogi',
            name: 'Shogi',
            ruleset: ShogiRuleset,
            minPlayers: 2,
            maxPlayers: 2,
            description: '古典的な将棋。',
            emoji: '☗',
            rules: '取った駒を自駒として使えるのが特徴です。相手の玉将を詰ませれば勝利。',
        })
        this.register({
            type: 'equilibrium',
            name: 'Equilibrium',
            ruleset: EquilibriumRuleset,
            minPlayers: 3,
            maxPlayers: 6,
            description: 'AIが考案した、魂を削り合う究極の心理戦ボードゲーム。',
            emoji: '⚖️',
            rules: 'AIによって設計された戦略的なボードゲーム。相手の心理を読み、均衡を崩します。',
        });
        this.register({
            type: 'mancala',
            name: 'Mancala',
            ruleset: MancalaRuleset,
            minPlayers: 2,
            maxPlayers: 2,
            description: '最古のボードゲームの一つ。石をまいて自分のストアに集めよう。',
            emoji: '🏺',
            rules: '自分の陣地の穴から石を選んで、時計回りに一つずつ置いていきます。最後に自分のストアに多くの石がある人の勝ちです。',
        });
        this.register({
            type: 'wordle',
            name: 'Wordle',
            ruleset: WordleRuleset,
            minPlayers: 1,
            maxPlayers: 1,
            description: '5文字の単語を当てるパズルゲーム。',
            emoji: '🟩',
            rules: '6回以内に5文字の英単語を当ててください。入力後、文字の位置が合っていれば緑、文字は含まれるが位置が違えば黄色、含まれていなければ灰色で表示されます。',
        });
        this.register({
            type: 'speed',
            name: 'Speed',
            ruleset: SpeedRuleset,
            minPlayers: 2,
            maxPlayers: 2,
            description: 'トランプの「スピード」。場札と±1の数字のカードを素早く出せ！',
            emoji: '⚡',
            rules: '台札と数字が1つ違い（A-2-3...K-A）のカードを、手札から場に出します。手札は山札から自動で5枚まで補充されます。先に全て出し切った方の勝ちです。詰まったら「めくる」ボタンで脇の札を台札に移動します。',
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