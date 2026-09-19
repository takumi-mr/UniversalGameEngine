# AGENTS.md — Universal Game Engine

AI コーディングエージェント（Claude Code, Codex, Cursor 等）と新規参加者向けの作業ガイド。
プロジェクトの思想・詳細な設計は [README.md](./README.md) と各パッケージの README を参照し、ここには **作業時に必要な事実と落とし穴** をまとめる。

## 1. プロジェクト概要

あらゆるボードゲーム・カードゲーム・パズルを **Reducer パターン（純粋関数 `reduce(state, action) -> newState`）** で統一的に動かす汎用ゲームエンジン。
ルール（`GameRuleset`）とエンジン実行環境（`UniversalEngine`）を分離し、Undo/Redo・リプレイ・差分同期・AI 探索・強化学習を全ゲームに一律で提供する。

Bun ワークスペースのモノレポ:

| パス              | 役割                                                                                                                                             | 主要技術                                            |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------- |
| `packages/shared` | コアエンジン、`GameRuleset` 実装（`rules/`）、AI（`ai/`）、gRPC proto（`network/`）。フロント・バックエンド双方から `@engine/shared/*` で import | TypeScript                                          |
| `apps/backend`    | ゲームサーバー。HTTP (Express) + Socket.io + gRPC。セッション管理・永続化                                                                        | Bun, Express, Socket.io, @grpc/grpc-js, Redis/Mongo |
| `apps/frontend`   | クライアント。ブラウザ / Electron                                                                                                                | Vue 3, Vite, Three.js, gRPC-web                     |
| `apps/ml`         | 強化学習クライアント。gRPC `Reset`/`Step`/`Simulate` で自己対戦し DQN / AlphaZero 風を学習、モデルを保存。Colab ノートブック同梱                 | Python 3.10+, PyTorch, grpcio                       |
| `models/`         | 学習済みモデルの保存先（`*.pt` は gitignore、メタ `.json` のみ追跡）                                                                             | —                                                   |

## 2. セットアップとよく使うコマンド

前提: **Bun 1.3+**、[Task](https://taskfile.dev/)（推奨）、Docker（Redis/MongoDB を使う場合）、Python 3.10+（`apps/ml` のみ）。

```bash
bun install                         # 依存関係（ルートで実行。ワークスペース全体）
task up / task down                 # Redis + MongoDB を docker compose で起動/停止
task dev                            # インフラ起動 + proto 生成 + backend/frontend 同時起動
task rl                             # backend を RL_MODE=true（インメモリ、DB 不要）で起動 → gRPC 学習用
task proto                          # packages/shared/network/game.proto → TS 型を再生成
task ml:train / ml:train-shogi / ml:train-chess / ml:train-go / ml:train-az / ml:train-az-shogi / ml:train-az-chess / ml:train-az-go / ml:eval   # apps/ml の DQN 学習 / AlphaZero 学習（オセロ / 将棋 / チェス / 囲碁）/ 評価（RL_MODE の backend が必要）
task ml:serve                       # 学習済みモデルを実対局の「gRPC External」席の相手として動かす（--checkpoint で指定）
task ml:test                        # apps/ml の単体テスト（pytest、サーバー不要）

bun run test                        # bun:test（packages/ と apps/backend）。パッケージ内で `bun test <pattern>` も可
bun run test:frontend               # vitest（apps/frontend: jsdom + @vue/test-utils）。`cd apps/frontend && bun run test:watch` で watch
bun run lint                        # eslint（error 0・warning 0 が基準。`any` は使わず、型を消す境界では `as unknown as X` と理由コメント）
bun run type-check                  # vue-tsc --noEmit（ルート tsconfig で apps/** と packages/** を tsconfig.base.json の厳しさで検査）
bun x prettier --check .            # フォーマット
```

個別起動: `cd apps/backend && bun dev`（`bun --watch server.ts`, HTTP :3000 / gRPC :50051）、`cd apps/frontend && bun dev`（Vite）。
環境変数: `REDIS_URL`, `MONGO_URL`, `JWT_SECRET`（**本番では必須**。未設定だと起動を拒否。開発では警告つきで開発用の値）, `PORT`, `GRPC_PORT`, `RL_MODE`（`.env` を Task が読み込む）。

## 3. アーキテクチャの要点（コードを触る前に知っておくこと）

### GameRuleset（`packages/shared/GameRules.ts`）

新しいゲーム = `GameRuleset<TState, TAction, TOptions>` の実装。シグネチャの要点:

```ts
getInitialState(options?, rng?) => TState
isValidAction(state, action) => boolean
reduce(state, action, rng?) => TState          // 純粋関数。state は dev/test では deepFreeze される
checkWinCondition(state) => GameResult          // { isFinished, winnerIds?, message? }
getLegalActions(state, playerId) => TAction[]   // AI・RL 用。必須
applyWinResult?, getTimeoutAction?              // 任意
```

- `BaseGameState` は `status: "WAITING" | "PLAYING" | "FINISHED"`, `players` (`{ "1": userId, "-1": userId }` のようなスロット→ID), `activePlayers`, `version`, `hash` を持つ。
- **着席と開始はエンジンの組み込みアクション** `JOIN` / `START` で行う（`UniversalEngine.dispatch`）。`JOIN {playerId, slot?}` は `state.players` の空席に着席させ（ルールセットが JOIN を受け付ければその reduce も走る）、`START` はルールセットが START を持たなければ `status = "PLAYING"` にして合法手を持つプレイヤーを `activePlayers` にする。どちらも `history` / `version` に記録されるので、リプレイは着席から再現できる。`dispatch` は `TAction | BuiltinAction`（`GameRules.ts`）を受け付けるので、`{ type: "JOIN", playerId }` をキャストなしで渡せる。サーバー（`join-game`、gRPC `Reset`）は必ず `dispatch` 経由で行い、`state.players[...] = ...` や `state.status = ...` を直接書かない（例外: `leave-game` の離席は未対応）。`isValidAction` は通常 `status !== "PLAYING"` なら false を返すため、ルールセットの単体テストでは `state.status = "PLAYING"; state.players = {...}` を手で設定する。
- パス処理（オセロ等）は `reduce` 内で完結させる。手番プレイヤーには必ず合法手がある状態を返す。
- 秘匿情報は `Secret<T>` / `createSecret()` で宣言し、`engine.getMaskedState(playerId)` に任せる（`maskState` は deprecated）。**`Secret` で包んでいない項目は観戦者を含む全員に平文で届く**（手札・山札・正解などは必ず包む）。サーバーシード `prngSecret` は `getMaskedState` が常に取り除く（`prngConfig` のハッシュ・`clientSeed`・`nonce` は公開）。
- 乱数は `IGameRNG` 経由のみ。**エンジンは常に RNG を渡す**（シード未指定でも自動生成し `prngConfig` / `prngSecret` に記録するので、あらゆる対局が再現可能）。ルールセットでは `requireRng(rng)`（`utils/requireRng.ts`）で受け取り、`Math.random` へのフォールバックは書かない — `determinism.test.ts` が全ゲームで `Math.random` 呼び出しを検出して落とす。ルールセットを直接呼ぶテストでは `testing/withTestRng.ts` でラップする。ID 生成も乱数に頼らない（`nextBlockId` のように既存キーから決定論的に採番する）。

### エンジンとサーバー

- `UniversalEngine.dispatch(action)` = clone → 組み込み JOIN 着席 → validate → freeze → reduce（不正なら組み込み START のみ）→ RNG 設定の引き継ぎ → checkWinCondition（`WAITING` 中は評価しない）→ version++ → hash。
- **バックエンドはステートレス**（複数インスタンス前提。詳細は [apps/backend/README.md](./apps/backend/README.md)）。真実の状態はリポジトリの `SessionRecord { type, state, bots }`、`apps/backend/store/sessionStore.ts` の `sessions` Map はインスタンスごとのキャッシュ。
  - 着手は必ず `session.server.dispatchAction(playerId, action)`（ロック → ストアより古ければ再読込 → dispatch → 保存 → 配信）。`handleAction` は無効化してある。**`dispatchAction` は `engine.dispatch(action, { builtin: false })` で呼ぶ**ので、組み込みの JOIN 着席・START のフォールバック・TIMEOUT は効かず、ルールセットの `isValidAction` が受け付けるものだけが適用される（クライアントが人数の足りない部屋を開始させたり途中の空席に座ったりできない）。サーバー内部の締切処理だけが `dispatchAction(playerId, { type: "TIMEOUT" }, { internal: true })` で組み込みを有効にする。
  - **部屋作成時の `options` は `apps/backend/gameOptions.ts` の `sanitizeCreateOptions` を通してからエンジンに渡す**（Socket.io `request-create-game` / gRPC `CreateGame`）。許可リスト方式で、共通キー（`clientSeed` / `playersConfig` / `addAi`）とゲームごとに登録したキーだけを型・範囲を確かめて通し、`serverSeed` / `autoHash` などのエンジン予約キー（`ENGINE_RESERVED_OPTION_KEYS`）や `playerIds` / `initialScores` のように席・点数を決めるキーは捨てる。ゲームに作成時オプションを足すときは `GAME_OPTION_SCHEMAS` に追加しないとクライアントから届かない。
  - エンジンを直接進める処理（JOIN / START / 離席、gRPC `Reset`）は `withSession(gameId, async (session) => { ...; await session.server.commit(); })` の中で行う。ロック外で `engine.dispatch` して保存しないと、別インスタンスの更新を上書きする。
  - セッションの取得は `ensureSession(gameId)`（なければストアから復元。`sessions.get` を直接使わない）。削除は `destroySession`。
  - 配信は `commit()` → `broadcastState()`（ローカルソケット + gRPC ストリーム + `serverSideEmit("uge:state-changed")`）。他インスタンスは `onRemoteStateChanged` で自分のクライアントに配り直す。AI の手番は対局を進めたインスタンスだけが起動する。
  - **配信ペイロードには「その更新を生んだアクション」が同梱される**（`dispatchAction` → `commit(action)` 経由のみ。`state-update` の第 2 引数 `{ action }` / `state-patch` の `action`、クラスタイベントにも載る。型は `StateUpdateMeta`）。フロントの効果音・演出の判定に使う。**部屋の全員（観戦者含む）に届くので、アクションに秘匿情報を載せない**（リプレイ記録も全アクションを公開している）。JOIN / START / 離席・再同期には付かない。
  - Socket.IO の在室判定は `io.in(room).fetchSockets()`（クラスタ全体）、自分のソケットだけなら `io.local`（`network/io.ts` の `countRoomSockets` / `fetchLocalSockets`）。`io.sockets.adapter.rooms` はローカルしか見えないので使わない。
- リポジトリは `useInMemoryStore()`（`RL_MODE=true` または `NODE_ENV=test`）で `InMemoryDummyRepository`、それ以外は `HybridGameRepository`（Redis + MongoDB）+ Socket.IO Redis アダプタ。**インメモリ実装もロック・クリーンアップ予約・一覧を同じ契約で実装しているので、テストは repo をモックせずそのまま使う**（テストごとに `listSessions` → `deleteSession` で掃除する）。
- 空室は 5 分で自動削除される（`scheduleRoomCleanup` → Redis ZSET に予約、各インスタンスの `startCleanupSweeper` が 15 秒ごとに回収）。長時間セッションを扱う処理は `clearRoomCleanup` / 再スケジュールを忘れない。

### AI と強化学習

- `packages/shared/ai/AIPlayer/`: `IAIPlayer` 実装（Random, Minimax, MCTS, ISMCTS, GrpcBot, LLM）。
- `packages/shared/ai/TensorAdapter/`: ゲーム状態 ⇄ テンソル/行動 ID 変換（`IAITensorAdapter`）。`index.ts` で `aiTensorRegistry` に登録する。**登録がないゲームは gRPC `Reset`/`Step` が `UNIMPLEMENTED`** を返す。現在登録済み: `othello`（64 要素・自分=+1/相手=-1、actionId = `y*size+x`）、`shogi` / `shogi_3d`（95 要素 = 自分視点の盤 81 + 持ち駒 7×2、actionId = 移動先マス × 27 + 種別、2187 通り）、`chess` / `chess_3d`（71 要素 = 自分視点の盤 64（黒は上下反転）+ キャスリング権 4 + アンパッサン 1 + 50 手カウンタ 1 + 同形回数 1、actionId = 移動先マス × 28 + 種別、1792 通り）、`go`（2N + 2 要素 = 自分視点の盤 N + 直前の盤 N + 連続パス数 1 + 自分視点のコミ 1。N = 盤のサイズ²。actionId = 打つ点の index、N がパス。9 路なら 164 / 82）。詳細は [apps/ml/README.md](./apps/ml/README.md)。観測次元 ≠ 行動数のゲームは Python 側 `games.py` の `GameSpec` に `n_actions` を書く。
- gRPC RL API（`packages/shared/network/game.proto`, 実装 `apps/backend/grpc-server.ts`）は **`RL_MODE=true` のときだけ有効**（それ以外は `PERMISSION_DENIED`）。無認証でセッションを操作し、マスクなしの状態を返すため本番で有効にしない。契約:
  - `Reset(game_id, player_ids?)`: 全席着席 + `PLAYING` 化。`active_players[0]` 視点の観測を返す。
  - `Step(game_id, player_id, action_id)`: 観測・合法手は **次に行動するプレイヤー視点**、`reward` は手を指した `player_id` 視点（勝 1 / 負 -1 / 引分 0.5、終局時のみ）。`Reset`/`Step` は完全な局面 `state_json` も返す。
  - `Simulate(game_type, state_json, player_id, action_id)` / `BatchSimulate(items)`: **セッションに触れないステートレスな 1 手適用**（木探索用）。失敗は gRPC エラーではなく `error` フィールドで返す。サーバーはゲームタイプごとに使い回す `UniversalEngine` に `loadState` → `dispatch` するだけなので、RNG や終局処理は通常対局と同じ挙動。ローカル計測: unary ≈ 1,500 sims/s、`BatchSimulate` x64 ≈ 10,000 sims/s（`apps/ml/scripts/bench_simulate.py`）。
  - E2E テスト: `apps/backend/grpc-rl.test.ts`。
- **実対局のボット（`grpc_bot`）**: 部屋作成時に `playersConfig` で `grpc_bot` を指定すると `GrpcBotPlayer` が着席し、手番が来るたびに `WaitForTurn` ストリーム（`state_tensor` / `legal_action_ids` / `state_json`）へ通知、外部プロセスが `SubmitTurn(action_id)` で指す（これらは RL_MODE でなくても使える）。`WaitForTurn` は接続時点で既にボットの手番なら、その手番を改めて送る（ボットが後から接続しても止まらない）。`GET /rooms/:gameType` の各部屋には `bots: BotSpec[]` が入るので、外部ボットはそこから自分の席（`playerId`）を見つける。Python 側の実装は `apps/ml/uge_rl/serve.py`（`task ml:serve`）。
- Python 側（`apps/ml/uge_rl/`）: `GrpcGameEnv` の上に **DQN**（`dqn.py` / `train.py`）と **AlphaZero 風**（`mcts.py` / `az_agent.py` / `train_az.py`。探索は `BatchSimulate`、Python はルールを持たない）。どちらも `select_action(obs, legal, state_json, player_id, env)` を実装し、`checkpoint.py` が `meta.format` で判別して復元する。MCTS の符号規約は `mcts.py` 冒頭のコメントと `tests/test_mcts.py` を正とする。1 局が終わらない・長引くゲーム（将棋・チェス・囲碁）は `--max-moves` で引き分け打ち切り。詳細は [apps/ml/README.md](./apps/ml/README.md)。

## 4. 変更手順のレシピ

### 新しいゲームを追加する

1. `packages/shared/rules/<Name>Ruleset.ts` を実装（[rules/README.md](./packages/shared/rules/README.md) のベストプラクティス: アクションディスパッチャ、フェーズ分割、`Secret<T>`）。
2. `packages/shared/GameRegistry.ts` に `register({ type, name, ruleset, minPlayers, maxPlayers, ... })`。`type` は小文字スネークケース（例 `othello_3d`）。クライアントに指定させる作成時オプション（盤サイズ等）があれば `apps/backend/gameOptions.ts` の `GAME_OPTION_SCHEMAS` に型・範囲つきで登録する。
3. テスト `packages/shared/rules/__tests__/<Name>Ruleset.test.ts`（bun:test）。
4. フロント: `src/components/game/<Name>.vue` を作成し、`apps/frontend/src/games/<type>/index.ts` に `defineGameUI({ type, category, component: () => import(...) })` を置く（`games/registry.ts` が自動収集し、対局・リプレイ・選択画面すべてに反映される。名前・人数などは GameRegistry から取る）。`src/i18n/` の `games.<type>` に name/description/rules を追加。コンポーネント内の「自分は誰か・何ができるか」は `useGameSession(props, emit, Ruleset)` の `isPlayer / isMyTurn / legalActions / can / send` を使い、ルール判定を UI に書かない。駒を選んで動かす系は `useSelectAndMove` も併用（`Chess.vue` 参照）。
   - 効果音を付けるなら `src/games/<type>/sound.ts` に `defineSoundProfile({ se, bgm?, onAction?, onStateChange?, bgmFor? })` を置き、`defineGameUI` に `sound: () => import("@/games/<type>/sound")` を足す（`src/sound/`、[apps/frontend/README.md](./apps/frontend/README.md) の「サウンド」）。開始 / 手番 / 勝敗の共通音は書かなくても鳴る。音源は `public/sounds/<game>/` に置く（リポジトリには含めない）。
5. AI 学習対象にするなら `ai/TensorAdapter/<Name>TensorAdapter.ts`（+ `.test.ts` で合法手との 1 対 1 対応を確認）+ `index.ts` 登録 + `apps/ml/uge_rl/games.py` に `GameSpec`。学習したモデルは `uge_rl.serve` でそのまま対局相手になる。

### proto を変更する

`packages/shared/network/game.proto` を編集 → `task proto`（TS 型、生成物は `network/generated/` にコミット）→ `bun x prettier --write "packages/shared/network/generated/**/*.ts"`（生成物はコミット時に prettier 済みの状態にする）→ `pip install grpcio-tools && python apps/ml/scripts/gen_proto.py`（Python スタブ、`apps/ml/proto/` にコミット）。

## 5. 規約と CI

- **コミット前フック**: `simple-git-hooks` + `lint-staged` が `prettier --write` と `eslint --fix` を staged ファイルに実行する。
- **CI（`.github/workflows/pr-check.yml`）**: PR で 2 ジョブ。`test-and-lint` は `bun install --frozen-lockfile --ignore-scripts` → `prettier --check .` → `bun run lint` → `bun run type-check` → `bun run test`（bun:test） → `bun run test:frontend`（vitest）。`ml-test` は Python 3.12 + CPU 版 torch で `apps/ml` の `pytest tests`。`bun install` を prettier より先に走らせるのは、**package.json で固定した prettier（3.8.x）を使うため**。順序を変えると最新 prettier のルール差で既存ファイルが落ちる。
- コミットメッセージは `feat:` / `fix:` / `refactor:` / `ci:` + 日本語の要約（既存ログに倣う）。マージは squash。
- コードコメントは日本語、識別子は英語。
- **Lint は error 0 が必須**（CI の `bun run lint` で落ちる）。`@typescript-eslint/no-explicit-any` は error なので `any` は書かない。
  - 型が本当に不明な値は `unknown` にして、使う場所で絞り込む（`err instanceof Error`, `typeof`, `instanceof THREE.Mesh` など）。
  - ゲームごとの型を消す境界（`GameRegistry.register`, `createSession`, `aiTensorRegistry`）では `BaseGameState` / `BaseGameAction` を使い、どうしても互換が取れない箇所だけ `as unknown as X` と理由コメントを書く。
  - 組み込みアクションは `engine.dispatch({ type: "JOIN", playerId })` とそのまま書く（`dispatch` は `TAction | BuiltinAction` を受け付ける）。マスク済み状態を読むテストは `Masked<TState>`、`prngSecret` は `InternalGameState` にキャストする。
  - Vue コンポーネントでサーバーから届く `Secret<T>` は展開済みなので、`(x as any).value` ではなく `revealed(x)`（`apps/frontend/src/utils/revealed.ts`）で読む。
  - テストのモック（Socket.IO の `Server` など）は `as unknown as Server` のように実際の型へキャストする。
  - 無効化（`eslint-disable`）で回避しない。
- **TypeScript の厳しさはルートの `tsconfig.base.json` で一元管理**し、全パッケージの tsconfig はそれを `extends` して lib / types / include だけを上書きする（frontend は `@vue/tsconfig` と base の多段 extends で、後者が優先）。有効: `strict`, `verbatimModuleSyntax`（型は `import type`）, `erasableSyntaxOnly`（`constructor(private x)` のようなパラメータプロパティ禁止）, `noImplicitOverride`, `noFallthroughCasesInSwitch`, `noUncheckedSideEffectImports`。無効: `noUncheckedIndexedAccess`（有効化すると repo 全体で 800 件超のエラーが出るため別 PR 扱い）, `noUnusedLocals/Parameters`（eslint に任せる）。フラグを足すときは base に足し、`bun run type-check` が通ることを確認する。
- **import は相対パスでなくワークスペースごとのエイリアスを使う**（同一パッケージ内でも）。`@/*` → `apps/frontend/src/*`、`@engine/backend/*` → `apps/backend/*`、`@engine/shared/*` → `packages/shared/*`、`@engine/input-prediction(/*)` → `packages/input-prediction/*`。例外は frontend の `src` 外（`network/`, `electron/`）との行き来と `packages/shared/network/generated/`（`task proto` の生成物）だけ相対パス。
  - 型検査はルート `tsconfig.json` の paths（apps と packages を 1 プログラムで検査するので接頭辞は被らせない）。各パッケージの tsconfig にも同じ paths をエディタ用に置いてある。
  - **実行時の解決は tsconfig の paths ではない**。`@engine/*` はルート `package.json` の devDependencies（`workspace:*`）が張る `node_modules/@engine/*` の symlink、`@/` は `apps/frontend/vite.config.ts` / `vitest.config.ts` の `resolve.alias`。Bun 1.3 は `baseUrl` 無しの paths を **cwd 基準**で解決してしまい、TS 7 は `baseUrl` をエラーにするので、Bun 向けに paths を足しても効かない。新しいワークスペースを作ったら `@engine/<name>` と命名し、ルート `package.json` の devDependencies に `workspace:*` で追加する。

## 6. 既知の落とし穴

- **Windows + git autocrlf**: 作業コピーは CRLF になるため、ローカルの `prettier --check .` が `README.md` / `Taskfile.yml` 等で警告を出すことがある。`--end-of-line auto` を付けると実態が分かる。CI（Linux）では発生しない。
- **`node_modules` の symlink 破損**: リポジトリのフォルダ名を変えると bun の store 内の絶対パス symlink が切れ、`ENOENT reading node_modules/.bun/...` になる。`bun install` は「no changes」と言って直さない。復旧は `rm -rf node_modules apps/*/node_modules packages/*/node_modules && bun install --frozen-lockfile --ignore-scripts && bun x simple-git-hooks`。（`--force` は Windows で simple-git-hooks の postinstall が落ちる）
- **`bun test` で gRPC の `expect(...).rejects.toMatchObject(...)`** は `ServiceError` に含まれる `Metadata` のせいでハングする。try/catch で `err.code` を取り出して比較する（`grpc-rl.test.ts` の `grpcErrorCode` を参照）。
- **`apps/ml/.venv` は eslint/prettier の対象外**にしてある（torch が `.mjs` を同梱するため）。新しい仮想環境を別名で作るなら `eslint.config.mjs` の `ignores` に追加する。
- テストがプロセスを掴んで終わらない場合は `timeout <sec> bun test ...` で保護する（gRPC サーバーやタイマーを起動するテストは `afterAll` で `forceShutdown()` すること）。
- backend のテストで Socket.IO をモックするときは `in(room).fetchSockets()` / `local.in(room).fetchSockets()` / `to(room).emit()` を用意する（`sockets.adapter.rooms` は使われない）。
- `bun test` は全ファイルを 1 プロセスで走らせるので、インメモリリポジトリの中身（セッション・クリーンアップ予約）はファイルをまたいで残る。`beforeEach` で消すこと。
- **フロントのテストは vitest**（`apps/frontend/vitest.config.ts`、`src/**/*.test.ts`）。ルートの `bun run test` は `bun test packages apps/backend` とパスで絞っているので frontend のテストは走らない（素の `bun test` を打つと拾ってしまい、jsdom 前提のテストが落ちる）。新しいワークスペースに bun:test を追加したらルート `package.json` の `test` スクリプトにパスを足す。
- Bash ツールで `cd` を含む複合コマンドを実行するとカレントディレクトリがサブパッケージに移ったままになることがある。パスは絶対指定にするか、コマンド先頭でリポジトリルートへ `cd` する。

## 7. 参照

- [README.md](./README.md) — 全体像、アーキテクチャ図、対応ゲーム一覧
- [packages/shared/README.md](./packages/shared/README.md) / [packages/shared/rules/README.md](./packages/shared/rules/README.md) / [packages/shared/ai/README.md](./packages/shared/ai/README.md)
- [apps/backend/README.md](./apps/backend/README.md) / [apps/frontend/README.md](./apps/frontend/README.md) / [apps/ml/README.md](./apps/ml/README.md)
