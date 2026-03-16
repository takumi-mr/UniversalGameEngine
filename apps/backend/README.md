# 🚀 Universal Game Engine - Backend

Bun + Socket.io を活用した、低レイテンシ・高並列なゲームサーバーです。

## 🏗️ ディレクトリ構造

- `/routes`: HTTP API エンドポイントの定義（認証、マッチメイキングなど）。
- `/socket`: Socket.io によるリアルタイム通信ハンドラー。
- `/store`: メモリ内の状態永続化ロジック。
- `/infra`: データベース接続や外部サービスのクライアント。
- `server.ts`: サーバーのエントリーポイント。

## 🛠️ 開発ガイド

### 依存関係のインストール

```bash
bun install
```

### 開発サーバーの起動

```bash
bun dev
```

### Lint / Format

```bash
bun x biome check .
```

## 🔌 リアルタイム通信 (WebSockets)

ゲームの更新は `UniversalEngine` を通じて処理され、`/socket` 配下のハンドラーによって全プレイヤーにブロードキャストされます。
認証が必要なアクションについては、JWTによる保護が適用されます。
