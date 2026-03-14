export const availableGames = [
  { type: 'tictactoe',    name: 'Tic Tac Toe',      description: '古典的な三目並べ。',                     emoji: '⭕', minPlayers: 2, maxPlayers: 2, category: 'Board Games' },
  { type: 'othello',      name: 'Othello',          description: '3D対応の本格オセロ（リバーシ）。',         emoji: '⚫', minPlayers: 2, maxPlayers: 2, category: 'Board Games' },
  { type: 'othello-3d',   name: '3D Othello',       description: '3D立体オセロ。26方向に挟める！',       emoji: '🟦', minPlayers: 2, maxPlayers: 2, category: 'Board Games' },
  { type: 'high-low',     name: 'High-Low Card',    description: '引いたカードの強さで競うカードゲーム。', emoji: '🃏', minPlayers: 1, maxPlayers: 2, category: 'Card Games' },
  { type: 'shogi',        name: '将棋 (Shogi)',      description: '日本の伝統的なボードゲーム。3D。',       emoji: '☖', minPlayers: 2, maxPlayers: 2, category: 'Board Games' },
  { type: 'chess',        name: 'Chess',           description: '世界的に人気の伝統的なチェス。',         emoji: '♟️', minPlayers: 2, maxPlayers: 2, category: 'Board Games' },
  { type: 'daifugo',      name: 'Daifugo',         description: 'トランプの定番、大富豪。',               emoji: '🎴', minPlayers: 2, maxPlayers: 6, category: 'Card Games' },
  { type: 'texas-holdem', name: "Texas Hold'em",    description: '本格ポーカー、テキサスホールデム。',     emoji: '🎰', minPlayers: 2, maxPlayers: 8, category: 'Card Games' },
  { type: 'go',           name: 'Go (囲碁)',        description: '伝統的な囲碁ゲーム。',                   emoji: '⚪', minPlayers: 2, maxPlayers: 2, category: 'Board Games' },
  { type: 'rubiks-cube',  name: "Rubik's Cube",     description: '1人用ルービックキューブ。3D。',           emoji: '🟥', minPlayers: 1, maxPlayers: 1, category: 'Puzzles' },
  { type: 'equilibrium',  name: 'Equilibrium',      description: 'AIが考案した、魂を削り合う究極の心理戦ボードゲーム。', emoji: '⚖️', minPlayers: 2, maxPlayers: 2, category: 'Special' },
];
