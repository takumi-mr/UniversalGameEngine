# 🎨 Universal Game Engine - Frontend

Vue 3 + Vite + TypeScript をベースとした、インタラクティブで高性能なゲームクライアントです。ブラウザおよび **Electron** によるデスクトップアプリとして動作します。

## 🏗️ ディレクトリ構造

- `/src/components`: UI 基盤部品および各ゲームの Vue コンポーネント。
- `/src/three`: Three.js による 3D 描画。各ゲームの UI クラスは `BaseThreeUI`（scene / camera / renderer / OrbitControls / リサイズ / 描画ループ / 破棄の共通化）を継承する。
- `/public/assets/games/<game>/models`: glTF（`.glb`）の駒・牌モデル。無ければ各 UI クラスがプレースホルダで代用する（麻雀は `mahjong/models/README.md` に規約あり）。
- `/src/sound`: 効果音・BGM（Web Audio）。ゲームごとの定義は `/src/games/<type>/sound.ts`、音源は `/public/sounds/<game>/`（下記「サウンド」）。
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

### テスト（vitest）

```bash
bun run test          # 一回実行（CI と同じ）
bun run test:watch    # watch モード
```

`src/**/*.test.ts` が対象（設定は `vitest.config.ts`。jsdom 環境、Vuetify はインライン化済み）。コンポーネントは `@vue/test-utils` の `mount` に Vuetify を plugin として渡す（例: `src/components/__tests__/ThemeSwitcher.test.ts`）。

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

- **Three.js**: **将棋 3D**, **ルービックキューブ**, **オセロ 3D**, **麻雀** など、実在感のある 3D インタラクション。
- **SVG / Canvas**: 囲碁や 2D ボードゲームでの正確なグリッド描画。
- **Vanilla CSS / DOM**: UNO や Wordle などの直感的なカード・テキスト表現。

### 5. サウンド（効果音 / BGM）

ルールセット・エンジンには一切手を入れず、フロント側だけで「サーバーが適用したアクション + 状態差分 → 効果音」を解決します。

```
src/games/<type>/sound.ts   defineSoundProfile({ se, bgm, onAction, onStateChange, bgmFor })
        │ defineGameUI({ sound: () => import("@/games/<type>/sound") })
        ▼
src/sound/useGameSound.ts   画面のライフサイクルでプロファイルをロード、状態更新ごとに評価、BGM 切替
        ├── src/sound/common.ts     全ゲーム共通: 開始 / 自分の手番 / 勝敗（checkWinCondition から自動）
        ├── src/store/sound.ts      音量・ミュート（localStorage）。UI は components/SoundMenu.vue
        ▼
src/sound/SoundDriver.ts    Web Audio: デコードキャッシュ、同時発音制限、クールダウン、BGM、自動再生アンロック
```

- **アクションはサーバーが同梱する**: `state-update` の第 2 引数 / `state-patch` の `action` に「その更新を生んだアクション」が入る（`dispatchAction` 経由のみ。JOIN / START / 離席には付かない）。自分・相手・AI の手がすべて同じ経路で届くので、プロファイルは `onAction(action, prev, next)` の表として書ける。アクションからは分からない結果（流局など）は `onStateChange(prev, next)` で状態差分から拾う。
- **共通音**（`game_start` / `my_turn` / `victory` / `defeat` / `draw` / `game_end`）はプロファイルを書かなくても鳴る。ゲーム側の `se` に同じキーを定義するとそのゲームだけ差し替わる（解決順: ゲーム → 共通）。
- **リプレイ**でも同じプロファイルが使われる（1 手ずつ進んだときだけ。シークでは鳴らさない。BGM は流さない）。
- **音源はリポジトリに含めていない。** `public/sounds/<game>/README.md` のファイル名で置く。未配置の音源は src ごとに 1 回だけ警告して無音（ゲームは止まらない）。
- 効果音は `{ key, delayMs }` で遅らせられる（盤面アニメーションに合わせるため。オセロの裏返しなど）。
- 画面から直接鳴らしたいときは `useSoundStore().playSE(key)`。
