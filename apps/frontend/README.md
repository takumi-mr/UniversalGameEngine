# 🎨 Universal Game Engine - Frontend

Vue 3 + Vite + TypeScript をベースとした、インタラクティブで高性能なゲームクライアントです。ブラウザおよび **Electron** によるデスクトップアプリとして動作します。

## 🏗️ ディレクトリ構造

- `/src/components`: UI 基盤部品および各ゲームの Vue コンポーネント。
- `/src/three`: Three.js による複雑な 3D 空間描画ロジック。
- `/src/network`: **gRPC-web** および Socket.io を統合したネットワーククライアント。
- `/electron`: Electron メインプロセスおよび プリロードスクリプト。
- `/src/i18n`: 多言語対応（日本語・英語など）。

## 🛠️ 開発ガイド

### 依存関係のインストール

```bash
bun install
```

### 開発サーバーの起動

```bash
bun dev          # ブラウザ版の起動
bun run dev:electron # Electron 版の起動
```

### ビルドとパッケージング

```bash
bun run build          # ブラウザ版のビルド
bun run build:electron # Electron デスクトップアプリのパッケージング
```

## 🚀 技術ハイライト

### 1. マルチプラットフォーム対応 (Electron)

同一の Web コードベースから、ブラウザ版とネイティブデスクトップアプリの両方を生成可能です。`vite-plugin-electron` を使用し、Vite の高速な HMR を Electron 開発でも活かしています。

### 2. ハイブリッド・ネットワーキング

通常のイベント通知は WebSocket (Socket.io) を用い、大量のデータ送信や厳密なアクション要求には **gRPC-web** を使用するハイブリッド構成を採用しています。

### 3. State Delta パッチ適用

バックエンドから送られてくる **JSON Patch (RFC 6902)** 形式の差分をクライアント側で適用することで、大規模なゲーム状態の更新時も再描画コストと通信量を大幅に削減します。

### 4. 多彩なレンダラー

ゲームの性質に応じた最適な描画手法を提供します。

- **Three.js**: **将棋 3D**, **ルービックキューブ**, **オセロ 3D** など、実在感のある 3D インタラクション。
- **SVG / Canvas**: 囲碁や 2D ボードゲームでの正確なグリッド描画。
- **Vanilla CSS / DOM**: UNO や Wordle などの直感的なカード・テキスト表現。
