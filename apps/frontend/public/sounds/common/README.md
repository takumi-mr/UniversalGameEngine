# sounds/common/

全ゲーム共通の効果音（`src/sound/common.ts`）。ゲーム側が同じキーを定義すればそのゲームだけ差し替わる。

| ファイル         | キー         | 鳴るタイミング                   |
| ---------------- | ------------ | -------------------------------- |
| `game_start.mp3` | `game_start` | WAITING → PLAYING                |
| `my_turn.mp3`    | `my_turn`    | 自分の手番が回ってきた           |
| `victory.mp3`    | `victory`    | 終局: 自分が勝者に含まれる       |
| `defeat.mp3`     | `defeat`     | 終局: 勝者がいて自分は含まれない |
| `draw.mp3`       | `draw`       | 終局: 勝者なし                   |
| `game_end.mp3`   | `game_end`   | 終局: 観戦者・リプレイ視点       |
