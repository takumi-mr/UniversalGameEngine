# 🚀 Universal Game Engine - Backend

Bun を活用した、低レイテンシ・高並列なゲームサーバーです。Socket.io と **gRPC** のデュアルプロトコルをサポートしています。

## 🏗️ ディレクトリ構造

- `/routes`: HTTP API エンドポイント（認証、マッチメイキングなど）。
- `/socket`: Socket.io による双方向リアルタイム通信（`index.ts`: ハンドラ、`roomManager.ts`: 在室管理と空室クリーンアップ）。
- **`grpc-server.ts`**: gRPC (Protocol Buffers) による高精度・低オーバーヘッド通信の実装。
- `/store`: セッション管理（`sessionStore.ts`）。真実の状態はリポジトリにあり、メモリはインスタンスごとのキャッシュ。
- `/infra`: データベース統合（`HybridGameRepository`: Redis + MongoDB / `InMemoryDummyRepository`: RL 用）。
- `/ai`: Web Worker で AI の思考を実行する `WorkerAIPlayer`。
- `/network`: gRPC ストリームの管理（`StreamManager`）、Socket.IO インスタンスとクラスタイベント（`io.ts`）。
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
bun test                # bun:test（ルートからは `bun run test`）
```

## 🔌 リアルタイム通信 (WebSockets)

ゲームの更新は `UniversalEngine` を通じて処理され、`/socket` 配下のハンドラーによって全プレイヤーにブロードキャストされます。
認証が必要なアクションについては、JWTによる保護が適用されます。

## 🧩 ステートレス構成（複数インスタンス）

バックエンドは何台並べても同じ対局を扱えるように作られている（`RL_MODE` / テスト以外では常にこのモード）。

- **真実はストア**: 対局の状態は `SessionRecord { type, state, bots }` として Redis（`game:session:{gameId}`、終局時は MongoDB にも）に保存される。メモリ上の `sessions` Map はキャッシュで、`ensureSession()` がなければストアから復元する（AI ボットも `bots` から再生成）。
- **着手はロックの中で**: `SocketGameServer.dispatchAction()` が `withSessionLock`（Redis `SET NX PX`）→ ストアより古ければ再読込 → `dispatch` → 配信 → 保存 を行う。Socket.io / HTTP / gRPC / AI のすべての着手がここを通るので、別インスタンスの更新を上書きしない。エンジンを直接進める処理（JOIN / START / 離席）は `withSession()` の中で行い `commit()` する。
- **クライアント由来のアクションに組み込みアクションは効かない**: `dispatchAction()` は `engine.dispatch(action, { builtin: false })` で呼ぶので、JOIN の着席・START のフォールバック（ルールセットが START を持たないゲームを PLAYING にする）・TIMEOUT はルールセットの `isValidAction` を通らない限り拒否される。着席は `join-game` / gRPC `Reset` が、時間切れは `deadlineSweeper` が（`{ internal: true }` で）サーバー側から行う。
- **部屋作成の `options` は許可リストを通す**: `gameOptions.ts` の `sanitizeCreateOptions(gameType, options)` が、共通キー（`clientSeed` / `playersConfig` / `addAi`）とゲームごとに登録したキーだけを型・範囲を確かめて通す。`serverSeed` などエンジンの予約キーや `playerIds` / `initialScores` は捨てる（作成者が乱数を固定したり席・点数を決めたりできないように）。
- **配信される状態にサーバーシードは含まれない**: `engine.getMaskedState()` が `prngSecret` を取り除く。終局後の開示はリプレイ記録の `finalServerSeed` で行う。
- **配信（write-behind）**: `@socket.io/redis-adapter` により `io.to(room).emit` と `fetchSockets()` はクラスタ全体に効く。状態更新は「自分のソケットへ配信 → 保存（ロック内） → `serverSideEmit("uge:state-changed")`」で、自分のクライアントは保存を待たずに受け取り、他のインスタンスは保存後に通知を受けて自分に接続しているソケット / gRPC ストリームにだけ配り直す。マスク・ハッシュ・差分パッチは配信先ごとではなく targetId（各プレイヤー / SPECTATOR）ごとに 1 回だけ計算する。`dispatchAction` 経由の更新には「その更新を生んだアクション」が同梱される（`state-update` の第 2 引数 `{ action }` / `state-patch` の `action`。`uge:state-changed` にも載せて他インスタンスも同梱できるようにする）。クライアントの効果音・演出用で、部屋の全員に届くのでアクションに秘匿情報を載せないこと。
- **リプレイ記録は追記ログ**: 完全な履歴は MongoDB の `game_replays` にだけある。`REPLAY_FLUSH_SIZE`（既定 100）手たまるごとに `appendGameRecord()` で追記し、追記できた分はエンジン（＝ Redis のセッション記録）から切り詰めるので、1 手あたりの保存サイズは手数に比例しない。終局時に残りを追記してサーバーシードを開示する。追記はドキュメントの `persistedVersion` で重複排除されるので、古いセッション記録から復元したインスタンスが再送しても記録は壊れない。追記に失敗しても対局は止めず、履歴は次の機会まで保持される。
- **空室クリーンアップ**: `setTimeout` ではなく Redis の ZSET（`game:cleanup`）に予約し、各インスタンスが 15 秒ごとに期限の来たものを取り出して掃除する（取り出しは Lua で原子的なので二重に消えない。掃除前にクラスタ全体の在室を再確認）。
- **ルーム一覧**: `/rooms` は Redis の一覧インデックス（`game:sessions`）から返し、在室数はアダプタ越しに数える。
- **終了**: SIGTERM で接続を閉じて終了する。状態はストアにあるので、クライアントは別のインスタンスへ再接続すれば続きから遊べる。

ローカルで試す: `PORT=3001 bun server.ts` と `PORT=3002 bun server.ts` を同じ Redis に向けて起動し、片方で作った部屋にもう片方から参加する。

## ⚡ 高度な機能

### 1. マルチプロトコル通信

WebSocket による柔軟なイベント駆動通信と、gRPC による型安全で高速なアクション処理を選択可能です。

### 2. State Delta (JSON Patch)

ゲーム状態の全更新を送信するのではなく、**fast-json-patch** を用いた差分（Delta）のみを転送することで、モバイル回線等の帯域制限下でもスムーズな同期を実現します。

### 3. 動的隠匿情報マスク (Secret Masking)

`packages/shared` の `Secret<T>` 型と連携し、プレイヤーの権限（観戦者、対戦者）に応じて機密情報を自動的にマスクして配信します。
