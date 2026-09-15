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
task ml:train / ml:train-az / ml:eval   # apps/ml の DQN 学習 / AlphaZero 学習 / 評価（RL_MODE の backend が必要）
task ml:test                        # apps/ml の単体テスト（サーバー不要）

bun test                            # 全テスト（ルート）。パッケージ内で `bun test <pattern>` も可
bun run lint                        # eslint（warning は多数あるが error 0 が基準）
bun run type-check                  # vue-tsc --noEmit（ルート tsconfig で apps/** と packages/** を対象）
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
- **着席と開始はエンジンの組み込みアクション** `JOIN` / `START` で行う（`UniversalEngine.dispatch`）。`JOIN {playerId, slot?}` は `state.players` の空席に着席させ（ルールセットが JOIN を受け付ければその reduce も走る）、`START` はルールセットが START を持たなければ `status = "PLAYING"` にして合法手を持つプレイヤーを `activePlayers` にする。どちらも `history` / `version` に記録されるので、リプレイは着席から再現できる。サーバー（`join-game`、gRPC `Reset`）は必ず `dispatch` 経由で行い、`state.players[...] = ...` や `state.status = ...` を直接書かない（例外: `leave-game` の離席は未対応）。`isValidAction` は通常 `status !== "PLAYING"` なら false を返すため、ルールセットの単体テストでは `state.status = "PLAYING"; state.players = {...}` を手で設定する。
- パス処理（オセロ等）は `reduce` 内で完結させる。手番プレイヤーには必ず合法手がある状態を返す。
- 秘匿情報は `Secret<T>` / `createSecret()` で宣言し、`engine.getMaskedState(playerId)` に任せる（`maskState` は deprecated）。
- 乱数は `IGameRNG` 経由のみ。**エンジンは常に RNG を渡す**（シード未指定でも自動生成し `prngConfig` / `prngSecret` に記録するので、あらゆる対局が再現可能）。ルールセットでは `requireRng(rng)`（`utils/requireRng.ts`）で受け取り、`Math.random` へのフォールバックは書かない — `determinism.test.ts` が全ゲームで `Math.random` 呼び出しを検出して落とす。ルールセットを直接呼ぶテストでは `testing/withTestRng.ts` でラップする。ID 生成も乱数に頼らない（`nextBlockId` のように既存キーから決定論的に採番する）。

### エンジンとサーバー

- `UniversalEngine.dispatch(action)` = clone → 組み込み JOIN 着席 → validate → freeze → reduce（不正なら組み込み START のみ）→ RNG 設定の引き継ぎ → checkWinCondition（`WAITING` 中は評価しない）→ version++ → hash。
- `apps/backend/store/sessionStore.ts`: `sessions: Map<gameId, { server: SocketGameServer, type }>`。`SocketGameServer.handleAction()` が dispatch と broadcast（Socket.io + gRPC ストリーム + JSON Patch 差分）を行う。
- リポジトリは `RL_MODE=true` で `InMemoryDummyRepository`、それ以外は `HybridGameRepository`（Redis + MongoDB）。
- 空室は 5 分で自動削除される（`scheduleRoomCleanup`）。長時間セッションを扱う処理は `clearRoomCleanup` / 再スケジュールを忘れない。

### AI と強化学習

- `packages/shared/ai/AIPlayer/`: `IAIPlayer` 実装（Random, Minimax, MCTS, ISMCTS, GrpcBot, LLM）。
- `packages/shared/ai/TensorAdapter/`: ゲーム状態 ⇄ テンソル/行動 ID 変換（`IAITensorAdapter`）。`index.ts` で `aiTensorRegistry` に登録する。**登録がないゲームは gRPC `Reset`/`Step` が `UNIMPLEMENTED`** を返す。現在登録済み: `othello`（64 要素・自分=+1/相手=-1、actionId = `y*size+x`）。
- gRPC RL API（`packages/shared/network/game.proto`, 実装 `apps/backend/grpc-server.ts`）は **`RL_MODE=true` のときだけ有効**（それ以外は `PERMISSION_DENIED`）。無認証でセッションを操作し、マスクなしの状態を返すため本番で有効にしない。契約:
  - `Reset(game_id, player_ids?)`: 全席着席 + `PLAYING` 化。`active_players[0]` 視点の観測を返す。
  - `Step(game_id, player_id, action_id)`: 観測・合法手は **次に行動するプレイヤー視点**、`reward` は手を指した `player_id` 視点（勝 1 / 負 -1 / 引分 0.5、終局時のみ）。`Reset`/`Step` は完全な局面 `state_json` も返す。
  - `Simulate(game_type, state_json, player_id, action_id)` / `BatchSimulate(items)`: **セッションに触れないステートレスな 1 手適用**（木探索用）。失敗は gRPC エラーではなく `error` フィールドで返す。サーバーはゲームタイプごとに使い回す `UniversalEngine` に `loadState` → `dispatch` するだけなので、RNG や終局処理は通常対局と同じ挙動。ローカル計測: unary ≈ 1,500 sims/s、`BatchSimulate` x64 ≈ 10,000 sims/s（`apps/ml/scripts/bench_simulate.py`）。
  - E2E テスト: `apps/backend/grpc-rl.test.ts`。
- Python 側（`apps/ml/uge_rl/`）: `GrpcGameEnv` の上に **DQN**（`dqn.py` / `train.py`）と **AlphaZero 風**（`mcts.py` / `az_agent.py` / `train_az.py`。探索は `BatchSimulate`、Python はルールを持たない）。どちらも `select_action(obs, legal, state_json, player_id, env)` を実装し、`checkpoint.py` が `meta.format` で判別して復元する。MCTS の符号規約は `mcts.py` 冒頭のコメントと `tests/test_mcts.py` を正とする。詳細は [apps/ml/README.md](./apps/ml/README.md)。

## 4. 変更手順のレシピ

### 新しいゲームを追加する

1. `packages/shared/rules/<Name>Ruleset.ts` を実装（[rules/README.md](./packages/shared/rules/README.md) のベストプラクティス: アクションディスパッチャ、フェーズ分割、`Secret<T>`）。
2. `packages/shared/GameRegistry.ts` に `register({ type, name, ruleset, minPlayers, maxPlayers, ... })`。`type` は小文字スネークケース（例 `othello_3d`）。
3. テスト `packages/shared/rules/__tests__/<Name>Ruleset.test.ts`（bun:test）。
4. フロント: `apps/frontend/src/constants/games.ts` に追加、`src/components/game/<Name>.vue` を作成し `GenericGameView.vue` の型ユニオン/マッピングに追加、必要なら `src/i18n/`。
5. AI 学習対象にするなら `ai/TensorAdapter/<Name>TensorAdapter.ts` + `index.ts` 登録 + `apps/ml/uge_rl/games.py` に `GameSpec`。

### proto を変更する

`packages/shared/network/game.proto` を編集 → `task proto`（TS 型、生成物は `network/generated/` にコミット）→ `bun x prettier --write "packages/shared/network/generated/**/*.ts"`（生成物はコミット時に prettier 済みの状態にする）→ `pip install grpcio-tools && python apps/ml/scripts/gen_proto.py`（Python スタブ、`apps/ml/proto/` にコミット）。

## 5. 規約と CI

- **コミット前フック**: `simple-git-hooks` + `lint-staged` が `prettier --write` と `eslint --fix` を staged ファイルに実行する。
- **CI（`.github/workflows/pr-check.yml`）**: PR で `bun install --frozen-lockfile --ignore-scripts` → `prettier --check .` → `bun run lint` → `bun run type-check` → `bun test`。`bun install` を prettier より先に走らせるのは、**package.json で固定した prettier（3.8.x）を使うため**。順序を変えると最新 prettier のルール差で既存ファイルが落ちる。
- コミットメッセージは `feat:` / `fix:` / `refactor:` / `ci:` + 日本語の要約（既存ログに倣う）。マージは squash。
- コードコメントは日本語、識別子は英語。ESLint の `any` 警告は既存コードに多いが、新規コードでは避ける。
- TypeScript は全パッケージ `strict`、`apps/backend` はさらに `noUncheckedIndexedAccess`（`arr[i]` は `T | undefined`）。backend から参照される shared のコードもこの制約で検査されるため、`!` か `?? fallback` で明示する。
- ルート `tsconfig.json` の paths で `@engine/shared/*` → `packages/shared/*`。バックエンドからは相対パスでなくこのエイリアスを使う。

## 6. 既知の落とし穴

- **Windows + git autocrlf**: 作業コピーは CRLF になるため、ローカルの `prettier --check .` が `README.md` / `Taskfile.yml` 等で警告を出すことがある。`--end-of-line auto` を付けると実態が分かる。CI（Linux）では発生しない。
- **`node_modules` の symlink 破損**: リポジトリのフォルダ名を変えると bun の store 内の絶対パス symlink が切れ、`ENOENT reading node_modules/.bun/...` になる。`bun install` は「no changes」と言って直さない。復旧は `rm -rf node_modules apps/*/node_modules packages/*/node_modules && bun install --frozen-lockfile --ignore-scripts && bun x simple-git-hooks`。（`--force` は Windows で simple-git-hooks の postinstall が落ちる）
- **`bun test` で gRPC の `expect(...).rejects.toMatchObject(...)`** は `ServiceError` に含まれる `Metadata` のせいでハングする。try/catch で `err.code` を取り出して比較する（`grpc-rl.test.ts` の `grpcErrorCode` を参照）。
- **`apps/ml/.venv` は eslint/prettier の対象外**にしてある（torch が `.mjs` を同梱するため）。新しい仮想環境を別名で作るなら `eslint.config.mjs` の `ignores` に追加する。
- テストがプロセスを掴んで終わらない場合は `timeout <sec> bun test ...` で保護する（gRPC サーバーやタイマーを起動するテストは `afterAll` で `forceShutdown()` すること）。
- Bash ツールで `cd` を含む複合コマンドを実行するとカレントディレクトリがサブパッケージに移ったままになることがある。パスは絶対指定にするか、コマンド先頭でリポジトリルートへ `cd` する。

## 7. 参照

- [README.md](./README.md) — 全体像、アーキテクチャ図、対応ゲーム一覧
- [packages/shared/README.md](./packages/shared/README.md) / [packages/shared/rules/README.md](./packages/shared/rules/README.md) / [packages/shared/ai/README.md](./packages/shared/ai/README.md)
- [apps/backend/README.md](./apps/backend/README.md) / [apps/frontend/README.md](./apps/frontend/README.md) / [apps/ml/README.md](./apps/ml/README.md)
