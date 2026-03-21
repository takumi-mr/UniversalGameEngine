# 🧠 Universal Game Engine - Shared (Core)

フロントエンドとバックエンドの双方で共有される、ゲームエンジンのコアロジック、AIエンジン、および共通のルールセット定義を格納しています。

## 🏗️ ディレクトリ構造

- `/rules`: 各ゲーム（オセロ、将棋、テキサスホールデム等 18 種以上）の実装。
- `/ai`: 統一された `IAIPlayer` インターフェースに基づく AI 探索アルゴリズム。
- `/network`: **gRPC** プロト定義および WebSocket 用のメッセージ型定義。
- `UniversalEngine.ts`: 状態遷移、バリデーション、差分計算を統括。
- `GameRegistry.ts`: 登録された全ゲームのメタデータ管理。

## 📐 設計の核心：GameRuleset

新しいゲームの実装は、以下の `GameRuleset` インターフェースを実装することで完了します。

```typescript
interface GameRuleset<S, A, R> {
  initialState(): S;
  validateAction(state: S, action: A): boolean;
  applyAction(state: S, action: A): S;
  getLegalActions(state: S, playerIndex: number): A[];
  // ゲーム完了後の結果取得
  getResult(state: S): R;
}
```

この強力な抽象化により、エンジンはゲームの具体的な挙動に依存せず、Undo/Redo、通信最適化、AI 探索などを全ゲームに一律に提供します。

## 🤖 先進的な AI 統合

- **探索アルゴリズム**: **Minimax (Alpha-Beta)**, **MCTS (モンテカルロ木探索)** が標準搭載されています。
- **AI テンソル連携 (`AITensorAdapter`)**: 各ゲームの状態を、TensorFlow.js 等の機械学習ライブラリで扱いやすい低次元テンソル形式（多次元配列）へ変換する仕組みを備えており、深層学習ベースの AI 開発を強力にバックアップします。
