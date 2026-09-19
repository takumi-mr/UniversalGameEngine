// packages/shared/GameRegistry.ts
import type { GameRuleset, BaseGameState, BaseGameAction } from "@engine/shared/GameRules";
import { TicTacToeRuleset } from "@engine/shared/rules/TicTacToeRuleset";
import { ChessRuleset } from "@engine/shared/rules/ChessRuleset";
import { ShogiRuleset } from "@engine/shared/rules/ShogiRuleset";
import { OthelloRuleset } from "@engine/shared/rules/OthelloRuleset";
import { Othello3DRuleset } from "@engine/shared/rules/Othello3DRuleset";
import { HighLowRuleset } from "@engine/shared/rules/HighLowRuleset";
import { TexasHoldemRuleset } from "@engine/shared/rules/TexasHoldemRuleset";
import { MahjongRuleset } from "@engine/shared/rules/mahjong/MahjongRuleset";
import { MahjongMatchRuleset } from "@engine/shared/rules/mahjong/MahjongMatchRuleset";
import { DaifugoRuleset } from "@engine/shared/rules/DaifugoRuleset";
import { RubiksRuleset } from "@engine/shared/rules/RubicCubeRuleset";
import { GoRuleset } from "@engine/shared/rules/GoRuleset";
import { EquilibriumRuleset } from "@engine/shared/rules/EquilibriumRuleset";
import { UnoRuleset } from "@engine/shared/rules/UnoRuleset";
import { SudokuRuleset } from "@engine/shared/rules/SudokuRuleset";
import { MancalaRuleset } from "@engine/shared/rules/MancalaRuleset";
import { WordleRuleset } from "@engine/shared/rules/WordleRuleset";
import { SpeedRuleset } from "@engine/shared/rules/SpeedRuleset";
import { MinesweeperRuleset } from "@engine/shared/rules/MinesweeperRuleset";
import { PokemonPocketRuleset } from "@engine/shared/rules/PokemonPocket/PokemonPocketRuleset";
import { WerewolfRuleset } from "@engine/shared/rules/WerewolfRuleset";
import { HanafudaRuleset } from "@engine/shared/rules/HanafudaRuleset";
import { NovelRuleset } from "@engine/shared/rules/NovelRuleset";
import { TheGameOfLifeRuleset } from "@engine/shared/rules/TheGameOfLifeRuleset";
import { HakoiriMusumeRuleset } from "@engine/shared/rules/HakoiriMusumeRuleset";
import { TowerOfHanoiRuleset } from "@engine/shared/rules/TowerOfHanoiRuleset";
import { LogicCircuitRuleset } from "@engine/shared/rules/LogicCircuitRuleset";
import { LogicLabRuleset } from "@engine/shared/rules/LogicLabRuleset";
import { CaveDiveRuleset } from "@engine/shared/rules/CaveDiveRuleset";
import { setSubGameResolver } from "@engine/shared/rules/subGameResolver";
import { DecathlonRuleset } from "@engine/shared/rules/DecathlonRuleset";
import { CyberStrikeRuleset } from "@engine/shared/rules/CyberStrikeRuleset";

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

/**
 * レジストリから取り出した定義。具体的な State / Action 型は登録時に消えているので、
 * 利用側はエンジン共通の BaseGameState / BaseGameAction として扱う。
 */
export type AnyGameDefinition = GameDefinition<BaseGameState, BaseGameAction>;

class GameRegistry {
  private games = new Map<string, AnyGameDefinition>();

  constructor() {
    this.register({
      type: "minesweeper",
      name: "Minesweeper",
      ruleset: MinesweeperRuleset,
      minPlayers: 1,
      maxPlayers: 1,
      description: "古典的なマインスイーパー。地雷を避けて全ての安全なマスを開けよう。",
      emoji: "💣",
      rules:
        "数字をヒントに地雷がないマスを開けていくパズルゲームです。全ての安全なマスを開けるとクリア、地雷を開けるとゲームオーバーです。",
    });
    this.register({
      type: "othello_3d",
      name: "3D Othello",
      ruleset: Othello3DRuleset,
      minPlayers: 2,
      maxPlayers: 2,
      description: "3D立体オセロ。26方向に挟める！",
      emoji: "🟦",
      rules:
        "石を置いて、上下左右、斜めに加えて、高さ（Z軸）方向も含む26方向に相手の石を挟んで自分の色に変えます。",
    });
    this.register({
      type: "othello",
      name: "Othello",
      ruleset: OthelloRuleset,
      minPlayers: 2,
      maxPlayers: 2,
      description: "古典的な2Dオセロ（リバーシ）。",
      emoji: "⚫",
      rules:
        "相手の石を挟んで自分の色に変える、伝統的なボードゲームです。最後に石が多いほうが勝ち。",
    });
    this.register({
      type: "chess",
      name: "Chess",
      ruleset: ChessRuleset,
      minPlayers: 2,
      maxPlayers: 2,
      description: "古典的なチェス。",
      emoji: "♟️",
      rules:
        "キング、クイーン、ルーク、ビショップ、ナイト、ポーンを動かして、相手のキングをチェックメイトします。",
    });
    this.register({
      type: "chess_3d",
      name: "Chess 3D",
      ruleset: ChessRuleset,
      minPlayers: 2,
      maxPlayers: 2,
      description: "3Dチェス。",
      emoji: "♔",
      rules:
        "キング、クイーン、ルーク、ビショップ、ナイト、ポーンを動かして、相手のキングをチェックメイトします。",
    });
    this.register({
      type: "shogi_3d",
      name: "Shogi 3D",
      ruleset: ShogiRuleset,
      minPlayers: 2,
      maxPlayers: 2,
      description: "3D将棋。",
      emoji: "☖",
      rules:
        "自分の駒を動かして相手の玉将を詰ませます。相手から取った駒を自分の持ち駒として使うことができます。",
    });
    this.register({
      type: "high_low",
      name: "High-Low Card",
      ruleset: HighLowRuleset,
      minPlayers: 1,
      maxPlayers: 2,
      description: "引いたカードの強さで競うカードゲーム。",
      emoji: "🃏",
      rules: "次に引くカードが現在のカードより「高い」か「低い」かを予想します。",
    });
    this.register({
      type: "uno",
      name: "UNO",
      ruleset: UnoRuleset,
      minPlayers: 2,
      maxPlayers: 10,
      description: "UNO。",
      emoji: "🃏",
      rules: "同じ色か同じ数字のカードを出していき、最初に手札がなくなった人の勝ちです。",
    });
    this.register({
      type: "texas_holdem",
      name: "Texas Hold'em",
      ruleset: TexasHoldemRuleset,
      minPlayers: 2,
      maxPlayers: 6,
      description: "テキサスホールデムポーカー。",
      emoji: "🎰",
      rules: "2枚の手札と5枚の共通カードを組み合わせて最強の役を作ります。",
    });
    this.register({
      type: "mahjong",
      name: "Mahjong",
      ruleset: MahjongRuleset,
      minPlayers: 4,
      maxPlayers: 4,
      description: "4人麻雀。役・符・点数計算対応。",
      emoji: "🀄",
      rules: "4つの面子（メンツ）と1つの雀頭（ジャントウ）を揃えて和了（あがり）を目指します。",
    });
    this.register({
      type: "mahjong_match",
      name: "Riichi Mahjong Match",
      ruleset: MahjongMatchRuleset,
      minPlayers: 4,
      maxPlayers: 4,
      description: "東風戦・半荘戦に対応したリーチ麻雀の対局。",
      emoji: "🀄",
      rules: "局を順番に進め、親・本場・連荘と最終順位を管理します。",
    });
    this.register({
      type: "daifugo",
      name: "大富豪",
      ruleset: DaifugoRuleset,
      minPlayers: 2,
      maxPlayers: 4,
      description: "大富豪（ジョーカー入り54枚）。",
      emoji: "🎴",
      rules:
        "手札を早く出し切り、大富豪を目指すトランプゲームです。オプションで革命（4枚以上の同ランク出しで強弱反転）・8切り（8を出すと場が流れる）といったローカルルールを有効にできます。",
    });
    this.register({
      type: "go",
      name: "Go",
      ruleset: GoRuleset,
      minPlayers: 2,
      maxPlayers: 2,
      description: "囲碁 (9x9, 13x13, 19x19)。Tromp-Taylor集計対応。",
      emoji: "⚪",
      rules: "石で盤面の囲いを広げ、陣地の広さを競います。",
    });
    this.register({
      type: "rubiks_cube",
      name: "Rubik's Cube",
      ruleset: RubiksRuleset,
      minPlayers: 1,
      maxPlayers: 1,
      description: "1人用ルービックキューブ。",
      emoji: "🟥",
      rules: "6つの面の各色を揃える立体パズルです。",
    });
    this.register({
      type: "sudoku",
      name: "Sudoku",
      ruleset: new SudokuRuleset(),
      minPlayers: 1,
      maxPlayers: 1,
      description: "古典的な数独パズル。",
      emoji: "🔢",
      rules: "9x9のマス目に1から9の数字を、各行、各列、3x3のブロックで重複しないように配置します。",
    });
    this.register({
      type: "tictactoe",
      name: "Tic Tac Toe",
      ruleset: TicTacToeRuleset,
      minPlayers: 2,
      maxPlayers: 2,
      description: "古典的な三目並べ。",
      emoji: "⭕",
      rules: "3x3のマス目に○と×を交互に書き、3つ並べたほうが勝ちというシンプルなゲーム。",
    });
    this.register({
      type: "shogi",
      name: "Shogi",
      ruleset: ShogiRuleset,
      minPlayers: 2,
      maxPlayers: 2,
      description: "古典的な将棋。",
      emoji: "☖",
      rules: "取った駒を自駒として使えるのが特徴です。相手の玉将を詰ませれば勝利。",
    });
    this.register({
      type: "equilibrium",
      name: "Equilibrium",
      ruleset: EquilibriumRuleset,
      minPlayers: 3,
      maxPlayers: 6,
      description: "AIが考案した、魂を削り合う究極の心理戦ボードゲーム。",
      emoji: "⚖️",
      rules: "AIによって設計された戦略的なボードゲーム。相手の心理を読み、均衡を崩します。",
    });
    this.register({
      type: "cave_dive",
      name: "掘るか、逃げるか",
      ruleset: CaveDiveRuleset,
      minPlayers: 2,
      maxPlayers: 8,
      description: "欲張るか、降りるか。全員同時に秘密で決めるプッシュ・ユア・ラック。",
      emoji: "⛏️",
      rules:
        "洞窟でカードをめくるたびに、残るか逃げるかを全員同時に秘密で選びます。宝は残っている人で山分け、同じ罠が2枚出たら崩落して残っていた人はそのラウンドの宝を失います。逃げたのが1人だけなら道端の端数も独り占め。5ラウンドの合計が最多の人が勝ち。松明は1回だけ次のカードを覗けます。",
    });
    this.register({
      type: "decathlon",
      name: "十種競技",
      ruleset: DecathlonRuleset,
      minPlayers: 2,
      maxPlayers: 4,
      description: "いろんなゲームを種目として渡り歩く総合戦。負けている人が次の種目を選ぶ。",
      emoji: "🏅",
      rules:
        "5 種目の総合得点を競います。各種目の前に最下位の人が 3 つの候補から種目を選び、出場者は「強気」か「堅実」かを秘密で宣言。勝ち 2 点・引き分け 1 点、強気で勝てば 2 倍、強気で勝てなければ 0 点で相手に +1。点差が開くと最下位ボーナス、最終種目は得点 2 倍。",
    });
    this.register({
      type: "mancala",
      name: "Mancala",
      ruleset: MancalaRuleset,
      minPlayers: 2,
      maxPlayers: 2,
      description: "最古のボードゲームの一つ。石をまいて自分のストアに集めよう。",
      emoji: "🏺",
      rules:
        "自分の陣地の穴から石を選んで、時計回りに一つずつ置いていきます。最後に自分のストアに多くの石がある人の勝ちです。",
    });
    this.register({
      type: "wordle",
      name: "Wordle",
      ruleset: WordleRuleset,
      minPlayers: 1,
      maxPlayers: 1,
      description: "5文字の単語を当てるパズルゲーム。",
      emoji: "🟩",
      rules:
        "6回以内に5文字の英単語を当ててください。入力後、文字の位置が合っていれば緑、文字は含まれるが位置が違えば黄色、含まれていなければ灰色で表示されます。",
    });
    this.register({
      type: "speed",
      name: "Speed",
      ruleset: SpeedRuleset,
      minPlayers: 2,
      maxPlayers: 2,
      description: "トランプの「スピード」。場札と±1の数字のカードを素早く出せ！",
      emoji: "⚡",
      rules:
        "台札と数字が1つ違い（A-2-3...K-A）のカードを、手札から場に出します。手札は山札から自動で5枚まで補充されます。先に全て出し切った方の勝ちです。詰まったら「めくる」ボタンで脇の札を台札に移動します。",
    });
    this.register({
      type: "pokemon_pocket",
      name: "Pokémon TCG Pocket",
      ruleset: new PokemonPocketRuleset(),
      minPlayers: 2,
      maxPlayers: 2,
      description:
        "Pokémon Trading Card Game Pocketのルールをベースにしたカードゲームです。3ポイント先取で勝利！",
      emoji: "🃏",
      rules:
        "エネルギーゾーンから毎ターンエネルギーをつけ、ポケモンを育てて戦います。相手のポケモンをきぜつさせて3ポイント獲得すると勝利です。",
    });
    this.register({
      type: "werewolf",
      name: "Werewolf",
      ruleset: WerewolfRuleset,
      minPlayers: 5,
      maxPlayers: 15,
      description: "正体隠匿系パーティーゲーム。村人陣営と人狼陣営に分かれて戦う。",
      emoji: "🐺",
      rules:
        "昼は話し合いと投票で怪しい人を処刑。夜は人狼が村人を襲撃。村人陣営は全ての人狼を処刑すれば勝利、人狼陣営は生存人狼数が村人陣営と同数以上になれば勝利。",
    });
    this.register({
      type: "hanafuda",
      name: "Hanafuda",
      ruleset: HanafudaRuleset,
      minPlayers: 2,
      maxPlayers: 2,
      description: "花札（こいこい）。季節の花を合わせよう。",
      emoji: "🎴",
      rules:
        "場札と手札の同じ月の札を合わせ、役を作ります。役ができたら「こいこい」でさらに高みを目指すか、「勝負」で終わらせるかを選びます。",
    });
    this.register({
      type: "novel",
      name: "Novel Game",
      ruleset: NovelRuleset,
      minPlayers: 1,
      maxPlayers: 1,
      description: "選択肢で物語が分岐するノベルゲーム。",
      emoji: "📖",
      rules: "テキストを読み進め、途中で現れる選択肢によって物語の結末が変化します。",
    });
    this.register({
      type: "the_game_of_life",
      name: "The Game of Life",
      ruleset: TheGameOfLifeRuleset,
      minPlayers: 2,
      maxPlayers: 4,
      description:
        "人生をシミュレーションするボードゲーム。就職、結婚、出産を経て、最終的な資産を競います。",
      emoji: "🎲",
      rules:
        "ルーレットを回して進み、止まったマスの指示に従います。給料日のマスを通過すると給料がもらえます。全員がゴールした時点で、最も多くの資産を持っているプレイヤーの勝ちです。",
    });
    this.register({
      type: "hakoiri_musume",
      name: "Hakoiri Musume",
      ruleset: HakoiriMusumeRuleset,
      minPlayers: 1,
      maxPlayers: 1,
      description: "古典的なスライディングパズル「箱入り娘」。娘を外に逃がそう。",
      emoji: "👧",
      rules:
        "4x5の盤面で駒をスライドさせ、2x2の「娘」の駒を中央下部の出口まで移動させるパズルゲームです。",
    });
    this.register({
      type: "tower_of_hanoi",
      name: "Tower of Hanoi",
      ruleset: TowerOfHanoiRuleset,
      minPlayers: 1,
      maxPlayers: 1,
      description: "ハノイの塔。全ての円盤を別の杭に移動させよう。",
      emoji: "🗼",
      rules:
        "3本の杭があり、最初は1本の杭に全ての円盤が小さい順に積まれています。一度に1枚しか動かせず、大きな円盤を小さな円盤の上に置くことはできません。全ての円盤を別の杭に移動させればクリアです。",
    });
    this.register({
      type: "logic_circuit",
      name: "Logic Circuit Sandbox",
      ruleset: LogicCircuitRuleset,
      minPlayers: 1,
      maxPlayers: 1,
      description: "論理回路を自由に組めるサンドボックスモード。",
      emoji: "🔌",
      rules:
        "様々な論理ゲート（AND, OR, NOT等）を配置して、自由に回路を組み立てることができます。デジタル回路の仕組みを学んだり、実験したりするのに最適です。",
    });
    this.register({
      type: "logic_lab",
      name: "Logic Lab",
      ruleset: LogicLabRuleset,
      minPlayers: 1,
      maxPlayers: 1,
      description: "論理回路パズル。期待される出力を得るための回路を設計しよう。",
      emoji: "🧠",
      rules:
        "各レベルで提示される「入力」と「期待される出力」のパターン（真理値表）を満たすように回路を設計します。単純なゲートから始まり、徐々に複雑な回路（加算器やCPU等）を目指します。",
    });
    this.register({
      type: "cyber_strike",
      name: "Cyber Strike",
      ruleset: CyberStrikeRuleset,
      minPlayers: 1,
      maxPlayers: 2,
      description: "入力予測とロールバックを備えたリアルタイム2Dサイバーアリーナ対戦アクション。",
      emoji: "⚡",
      rules:
        "WASD/矢印キーで移動、Spaceでブーストダッシュ、クリック/Enterでレーザーショット。障害物や壁の反射、パワーアップを活用して相手のHPを0に削り切ろう！",
    });
  }

  register<TState extends BaseGameState, TAction extends BaseGameAction>(
    def: GameDefinition<TState, TAction>,
  ) {
    // 型ごとに異なるルールセットを 1 つの Map に入れるため、ここで型を消す
    this.games.set(def.type, def as unknown as AnyGameDefinition);
  }

  getDefinition(type: string): AnyGameDefinition | undefined {
    return this.games.get(type);
  }

  getAllDefinitions() {
    return Array.from(this.games.values()).map((g) => ({
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

// メタ系ルールセット（MetaGame / Decathlon）がサブゲームを type 名から引けるようにする
setSubGameResolver((type) => gameRegistry.getDefinition(type));
