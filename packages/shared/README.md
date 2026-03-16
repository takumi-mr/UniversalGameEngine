# 🧠 Universal Game Engine - Shared (Core)

フロントエンドとバックエンドの双方で利用される、ゲームエンジンのコアロジックと各ゲームのルール定義を格納しています。

## 🏗️ ディレクトリ構造

- `/rules`: 各ゲーム（オセロ、将棋、ポーカーなど）の `GameRuleset` 実装。
- `/ai`: 統一された `IAIPlayer` インターフェースに基づく AI プレイヤーの実装。
- `/network`: 通信プロトコルやメッセージの型定義。
- `/stores`: ゲームの状態を保持するためのイミュータブルなデータ構造。
- `UniversalEngine.ts`: 状態遷移とバリデーションを統括するエンジン本体。
- `GameRegistry.ts`: 起動時に利用可能なゲームを登録・管理するレジストリ。

## 📐 設計の核心：GameRuleset

新しいゲームを追加するには、`GameRuleset<TState, TAction>` インターフェースを実装します。

```typescript
interface GameRuleset<S, A> {
  initialState(): S;
  validateAction(state: S, action: A): boolean;
  applyAction(state: S, action: A): S;
  getLegalActions(state: S, playerIndex: number): A[];
  isGameOver(state: S): boolean;
}
```

このインターフェースに従うことで、エンジンはゲームの具体的なルールを知ることなく、状態の更新、情報のマスク、AI による探索を自動的に行うことができます。

## 🤖 AI の統合

`shared` パッケージには、Minimax, MCTS などの汎用的な探索アルゴリズムも含まれており、任意の `GameRuleset` に対して即座に適用可能です。
