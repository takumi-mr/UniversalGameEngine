# 🧠 Universal Game Engine - Shared (Core)

フロントエンドとバックエンドの双方で共有される、ゲームエンジンのコアロジック、AIエンジン、および共通のルールセット定義を格納しています。

## 🏗️ ディレクトリ構造

- `/rules`: 各ゲーム（オセロ、将棋、テキサスホールデム等 18 種以上）の実装。
- `/ai`: 統一された `IAIPlayer` インターフェースに基づく AI 探索アルゴリズム（`AIPlayer/`）と、状態⇄テンソル変換（`TensorAdapter/`）。
- `/network`: **gRPC** プロト定義および WebSocket 用のメッセージ型定義。
- `UniversalEngine.ts`: 状態遷移、バリデーション、差分計算を統括。
- `GameRegistry.ts`: 登録された全ゲームのメタデータ管理。

## 📐 設計の核心：GameRuleset

新しいゲームの実装は、[`GameRules.ts`](./GameRules.ts) の `GameRuleset` インターフェースを実装し、[`GameRegistry.ts`](./GameRegistry.ts) に登録することで完了します。

```typescript
interface GameRuleset<TState extends BaseGameState, TAction extends BaseGameAction, TOptions> {
  // 初期状態を生成する（乱数が必要な場合は rng を使う）
  getInitialState: (options?: TOptions, rng?: IGameRNG) => TState;
  // そのアクションが現在の状態で合法かどうか
  isValidAction: (state: TState, action: TAction) => boolean;
  // 新しい状態を返す純粋関数（Reducer）。開発環境では state は deepFreeze される
  reduce: (state: TState, action: TAction, rng?: IGameRNG) => TState;
  // 終了判定と勝者（{ isFinished, winnerIds?, message? }）
  checkWinCondition: (state: TState) => GameResult;
  // 特定プレイヤーが今指せる合法手の完全なリスト（AI・強化学習用）
  getLegalActions: (state: TState, playerId: string) => TAction[];

  // 任意
  applyWinResult?: (state: TState, result: GameResult) => TState; // 終局時のスコア精算等
  getTimeoutAction?: (state: TState) => TAction | null; // 制限時間切れ時の自動アクション
}
```

プレイヤーの着席（`state.players`）と `status` の `WAITING → PLAYING` 遷移はルールセットの外側（バックエンドの `join-game` / gRPC `Reset`）で行われます。ルールセットは `status === "PLAYING"` のときだけアクションを受け付ける前提で実装してください。

この強力な抽象化により、エンジンはゲームの具体的な挙動に依存せず、Undo/Redo、通信最適化、AI 探索などを全ゲームに一律に提供します。

## 🤖 先進的な AI 統合

- **探索アルゴリズム**: **Minimax (Alpha-Beta)**, **MCTS (モンテカルロ木探索)** が標準搭載されています。
- **AI テンソル連携 (`IAITensorAdapter`)**: 各ゲームの状態を機械学習ライブラリで扱いやすい数値配列へ変換する仕組み。[`ai/TensorAdapter/`](./ai/TensorAdapter/) に実装して登録すると、バックエンドの gRPC `Reset` / `Step` から強化学習ループ（[`apps/ml`](../../apps/ml/README.md)）で利用できます。
