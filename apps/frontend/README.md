# 🎨 Universal Game Engine - Frontend

Vue 3 + Vite + TypeScript をベースとした、インタラクティブなゲームクライアントです。

## 🏗️ ディレクトリ構造

- `/src/components`: 再利用可能な UI コンポーネントおよび各ゲームのメインコンポーネント。
- `/src/ui`: Game-specific UI クラス。Three.js による 3D 描画や DOM 操作のロジックをカプセル化。
- `/src/stores`: Pinia によるグローバルな状態管理（認証情報、マッチ情報など）。
- `/src/api`: バックエンドとの通信（HTTP/WebSocket）をラップしたクライアント。
- `vite.config.ts`: Vite の設定ファイル。

## 🛠️ 開発ガイド

### 依存関係のインストール

```bash
bun install
```

### 開発サーバーの起動

```bash
bun dev
```

## 🖼️ レンダラーの柔軟性

本フロントエンドは、ゲームの性質に応じて最適なレンダリング方式を選択できます。
現時点では以下のレンダラーで各ゲームを実装しています。
- **Three.js**: 将棋、囲碁、オセロなどの 3D 表示
- **SVG / Canvas**: 2D ボードゲーム
- **Vanilla CSS / DOM**: カードゲームやパズル
