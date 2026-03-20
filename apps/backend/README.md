# 🚀 Universal Game Engine - Backend

Bun を活用した、低レイテンシ・高並列なゲームサーバーです。Socket.io と **gRPC** のデュアルプロトコルをサポートしています。

## 🏗️ ディレクトリ構造

- `/routes`: HTTP API エンドポイント（認証、マッチメイキングなど）。
- `/socket`: Socket.io による双方向リアルタイム通信。
- **`grpc-server.ts`**: gRPC (Protocol Buffers) による高精度・低オーバーヘッド通信の実装。
- `/store`: ゲーム状態のメモリ内管理。
- `/infra`: データベースおよび外部サービス統合。
- `server.ts`: サーバーエントリーポイント。

## 🛠️ 開発ガイド

### 依存関係のインストール

```bash
bun install
```

### 開発サーバーの起動

```bash
bun dev          # WebSocket + HTTP
# または
bun run dev:grpc # gRPC サーバーの個別起動
```

### Lint / Format

```bash
bun x biome check .
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
