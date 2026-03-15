export const availableGames = [
  {
    type: 'tictactoe',
    name: 'Tic Tac Toe',
    description: '古典的な三目並べ。',
    emoji: '⭕',
    minPlayers: 2,
    maxPlayers: 2,
    category: 'Board Games',
    rules: '3x3のマス目に○と×を交互に書き、3つ並べたほうが勝ちというシンプルなゲーム。'
  },
  {
    type: 'othello',
    name: 'Othello',
    description: '3D対応の本格オセロ（リバーシ）。',
    emoji: '⚫',
    minPlayers: 2,
    maxPlayers: 2,
    category: 'Board Games',
    rules: '相手の石を挟んで自分の色に変える、伝統的なボードゲームです。最後に石が多いほうが勝ち。'
  },
  {
    type: 'othello_3d',
    name: '3D Othello',
    description: '3D立体オセロ。26方向に挟める！',
    emoji: '🟦',
    minPlayers: 2,
    maxPlayers: 2,
    category: 'Board Games',
    rules: '石を置いて、上下左右、斜めに加えて、高さ（Z軸）方向も含む26方向に相手の石を挟んで自分の色に変えます。'
  },
  {
    type: 'high_low',
    name: 'High-Low Card',
    description: '引いたカードの強さで競うカードゲーム。',
    emoji: '🃏',
    minPlayers: 1,
    maxPlayers: 2,
    category: 'Card Games',
    rules: '次に引くカードが現在のカードより「高い」か「低い」かを予想します。'
  },
  {
    type: 'shogi',
    name: '将棋 (Shogi)',
    description: '日本の伝統的なボードゲーム。3D。',
    emoji: '☖',
    minPlayers: 2,
    maxPlayers: 2,
    category: 'Board Games',
    rules: '取った駒を自駒として使えるのが特徴です。相手の玉将を詰ませれば勝利。'
  },
  {
    type: 'chess',
    name: 'Chess',
    description: '世界的に人気の伝統的なチェス。',
    emoji: '♟️',
    minPlayers: 2,
    maxPlayers: 2,
    category: 'Board Games',
    rules: 'キング、クイーン、ルーク、ビショップ、ナイト、ポーンを動かして、相手のキングをチェックメイトします。'
  },
  {
    type: 'daifugo',
    name: 'Daifugo',
    description: 'トランプの定番、大富豪。',
    emoji: '🎴',
    minPlayers: 2,
    maxPlayers: 6,
    category: 'Card Games',
    rules: '手札を早く出し切り、大富豪を目指すトランプゲームです。革命や階段などの独自ルールもあります。'
  },
  {
    type: 'texas_holdem',
    name: "Texas Hold'em",
    description: '本格ポーカー、テキサスホールデム。',
    emoji: '🎰',
    minPlayers: 2,
    maxPlayers: 8,
    category: 'Card Games',
    rules: '2枚の手札と5枚の共通カードを組み合わせて最強の役を作ります。'
  },
  {
    type: 'go',
    name: 'Go (囲碁)',
    description: '伝統的な囲碁ゲーム。',
    emoji: '⚪',
    minPlayers: 2,
    maxPlayers: 2,
    category: 'Board Games',
    rules: '石で盤面の囲いを広げ、陣地の広さを競います。'
  },
  {
    type: 'rubiks_cube',
    name: "Rubik's Cube",
    description: '1人用ルービックキューブ。3D。',
    emoji: '🟥',
    minPlayers: 1,
    maxPlayers: 1,
    category: 'Puzzles',
    rules: '6つの面の各色を揃える立体パズルです。'
  },
  {
    type: 'sudoku',
    name: '数独 (Sudoku)',
    description: '9×9マスに数字を配置する定番パズル。',
    emoji: '🔢',
    minPlayers: 1,
    maxPlayers: 1,
    category: 'Puzzles',
    rules: '9x9のマス目に1から9の数字を、各行・各列・3x3ブロックで重複しないように配置します。'
  },
  {
    type: 'equilibrium',
    name: 'Equilibrium',
    description: 'AIが考案した、魂を削り合う究極の心理戦ボードゲーム。',
    emoji: '⚖️',
    minPlayers: 2,
    maxPlayers: 2,
    category: 'Special',
    rules: 'AIによって設計された戦略的なボードゲーム。相手の心理を読み、均衡を崩します。'
  },
  {
    type: 'uno',
    name: 'UNO',
    description: 'UNO。',
    emoji: '🃏',
    minPlayers: 2,
    maxPlayers: 10,
    category: 'Card Games',
    rules: '同じ色か同じ数字のカードを出していき、最初に手札がなくなった人の勝ちです。'
  },
  {
    type: 'mancala',
    name: 'Mancala',
    description: '最古のボードゲームの一つ。石をまいて自分のストアに集めよう。',
    emoji: '🏺',
    minPlayers: 2,
    maxPlayers: 2,
    category: 'Board Games',
    rules: '自分の陣地の穴から石を選んで、時計回りに一つずつ置いていきます。最後に自分のストアに多くの石がある人の勝ちです。'
  },
];
