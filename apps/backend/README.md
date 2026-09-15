# 🚀 Universal Game Engine - Backend

Bun を活用した、低レイテンシ・高並列なゲームサーバーです。Socket.io と **gRPC** のデュアルプロトコルをサポートしています。

## 🏗️ ディレクトリ構造

- `/routes`: HTTP API エンドポイント（認証、マッチメイキングなど）。
- `/socket`: Socket.io による双方向リアルタイム通信。
- **`grpc-server.ts`**: gRPC (Protocol Buffers) による高精度・低オーバーヘッド通信の実装。
- `/store`: ゲーム状態のメモリ内管理（`sessionStore.ts`。`RL_MODE` でリポジトリ実装を切り替え）。
- `/infra`: データベース統合（`HybridGameRepository`: Redis + MongoDB / `InMemoryDummyRepository`: RL 用）。
- `/ai`: Web Worker で AI の思考を実行する `WorkerAIPlayer`。
- `/network`: gRPC ストリームの管理（`StreamManager`）。
- `server.ts`: サーバーエントリーポイント。

## 🛠️ 開発ガイド

### 依存関係のインストール

```bash
bun install
```

### 開発サーバーの起動

```bash
bun dev          # HTTP (:3000) + Socket.io + gRPC (:50051) を同時に起動（bun --watch server.ts）
```

強化学習用に Redis / MongoDB なしで起動する場合はリポジトリルートで `task rl`（`RL_MODE=true`）を使います。

### Lint / Format / Test

リポジトリルートで実行します。

```bash
bun run lint            # eslint
bun x prettier --check .
bun test                # bun:test
```

## 🔌 リアルタイム通信 (WebSockets)

ゲームの更新は `UniversalEngine` を通じて処理され、`/socket` 配下のハンドラーによって全プレイヤーにブロードキャストされます。
認証が必要なアクションについては、JWTによる保護が適用されます。

## ⚡ 高度な機能

### 1. マルチプロトコル通信

WebSocket による柔軟なイベント駆動通信と、gRPC による型安全で高速なアクション処理を選択可能です。

### 2. State Delta (JSON Patch)

ゲーム状態の全更新を送信するのではなく、**fast-json-patch** を用いた差分（Delta）のみを転送することで、モバイル回線等の帯域制限下でもスムーズな同期を実現します。

### 3. 動的隠匿情報マスク (Secret Masking)

`packages/shared` の `Secret<T>` 型と連携し、プレイヤーの権限（観戦者、対戦者）に応じて機密情報を自動的にマスクして配信します。
