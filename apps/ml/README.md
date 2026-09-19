# 🧠 apps/ml — 強化学習クライアント (Python)

Universal Game Engine の gRPC RL API（`Reset` / `Step`）を使って、ゲーム AI を自己対戦で学習させる Python パッケージです。
**DQN**（Double DQN + 合法手マスク）と **AlphaZero 風**（Policy/Value ネット + MCTS、探索は gRPC `BatchSimulate`）の 2 方式を実装しており、
対応ゲームは **オセロ**、**将棋**（`shogi` / `shogi_3d`）、**チェス**（`chess` / `chess_3d`）です。学習したモデルは `uge_rl.serve` で実際の対局相手として動かせます。

```
apps/ml/
├── uge_rl/
│   ├── env.py         # gRPC を包む Gym 風環境 (GrpcGameEnv)
│   ├── games.py       # ゲームごとの観測エンコーディング (GameSpec)
│   ├── dqn.py         # DQN: Q ネットワーク / リプレイバッファ / DQNAgent
│   ├── train.py       # DQN の学習 CLI
│   ├── az_net.py      # AlphaZero: Policy/Value ネット
│   ├── mcts.py        # AlphaZero: PUCT 探索（BatchSimulate でノード展開）
│   ├── az_agent.py    # AlphaZero: 自己対戦・学習・対局
│   ├── train_az.py    # AlphaZero の学習 CLI
│   ├── checkpoint.py  # モデルの保存・読み込み (.pt + .json)。format で DQN / AZ を判別
│   ├── evaluate.py    # 評価 CLI（対ランダム勝率）。両方式共通
│   └── serve.py       # 学習済みモデルを実対局の「gRPC External」席の指し手として動かすボットサーバー
├── tests/test_mcts.py  # MCTS のバックアップ規約の単体テスト（サーバー不要。CI では pytest で実行）
├── tests/test_games.py # GameSpec（観測 → NN 入力）の単体テスト
├── proto/             # game.proto から生成した Python スタブ（コミット済み）
├── scripts/gen_proto.py            # proto から Python スタブを再生成
├── scripts/bench_simulate.py       # Simulate / BatchSimulate のスループット計測
├── notebooks/othello_dqn_colab.ipynb        # Google Colab 用ノートブック (オセロ DQN)
├── notebooks/othello_alphazero_colab.ipynb  # Google Colab 用ノートブック (オセロ AlphaZero)
├── notebooks/shogi_dqn_colab.ipynb          # Google Colab 用ノートブック (将棋 DQN)
├── notebooks/shogi_alphazero_colab.ipynb    # Google Colab 用ノートブック (将棋 AlphaZero)
├── notebooks/chess_dqn_colab.ipynb          # Google Colab 用ノートブック (チェス DQN)
├── notebooks/chess_alphazero_colab.ipynb    # Google Colab 用ノートブック (チェス AlphaZero)
└── requirements.txt
```

## Google Colab で学習する（推奨）

[notebooks/othello_dqn_colab.ipynb](./notebooks/othello_dqn_colab.ipynb)（オセロ DQN）、[notebooks/othello_alphazero_colab.ipynb](./notebooks/othello_alphazero_colab.ipynb)（オセロ AlphaZero）、[notebooks/shogi_dqn_colab.ipynb](./notebooks/shogi_dqn_colab.ipynb)（将棋 DQN）、[notebooks/shogi_alphazero_colab.ipynb](./notebooks/shogi_alphazero_colab.ipynb)（将棋 AlphaZero）、[notebooks/chess_dqn_colab.ipynb](./notebooks/chess_dqn_colab.ipynb)（チェス DQN）、[notebooks/chess_alphazero_colab.ipynb](./notebooks/chess_alphazero_colab.ipynb)（チェス AlphaZero）を Colab で開き、上から順に実行してください。
ノートブックが Colab 内で Bun とバックエンドを起動し、学習済みモデルを **Google Drive** (`MyDrive/UniversalGameEngine/models/`) に保存します。

## ローカルで学習する

```bash
# 1. バックエンドを RL モード（Redis/MongoDB 不要・インメモリ）で起動
task rl            # = RL_MODE=true bun run apps/backend/server.ts

# 2. Python 環境
cd apps/ml
python -m venv .venv && .venv/Scripts/activate   # macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt

# 3a. DQN の学習（models/othello_dqn.pt と models/othello_dqn.json が保存される）
python -m uge_rl.train --game othello --episodes 2000 --out ../../models/othello_dqn.pt

# 3b. AlphaZero の学習（1 イテレーション = 自己対戦 N 局 + 勾配更新）
python -m uge_rl.train_az --game othello --iterations 30 --games-per-iter 20 --simulations 100 --out ../../models/othello_az.pt

# 3c. 将棋の DQN（task ml:train-shogi と同じ。1 局が長いので --max-moves で引き分け打ち切り）
python -m uge_rl.train --game shogi --episodes 3000 --max-moves 256 --eps-decay-steps 200000 --out ../../models/shogi_dqn.pt

# 3d. 将棋の AlphaZero（task ml:train-az-shogi と同じ）
python -m uge_rl.train_az --game shogi --iterations 30 --games-per-iter 10 --simulations 100 --max-moves 256 --dirichlet-alpha 0.15 --out ../../models/shogi_az.pt

# 3e. チェスの DQN / AlphaZero（task ml:train-chess / ml:train-az-chess と同じ）
python -m uge_rl.train --game chess --episodes 3000 --max-moves 200 --eps-decay-steps 200000 --out ../../models/chess_dqn.pt
python -m uge_rl.train_az --game chess --iterations 30 --games-per-iter 10 --simulations 100 --max-moves 200 --dirichlet-alpha 0.3 --out ../../models/chess_az.pt

# 4. 評価（どちらの形式でも同じコマンド。format を見て復元する）
python -m uge_rl.evaluate --checkpoint ../../models/othello_az.pt --games 100

# 5. MCTS の単体テスト（サーバー不要。CI と同じコマンド。pip install pytest が必要。pytest なしなら python -m tests.test_mcts）
python -m pytest tests -q
```

主なオプション（DQN: `python -m uge_rl.train --help`）:

| オプション                      | 既定値                  | 説明                                                         |
| ------------------------------- | ----------------------- | ------------------------------------------------------------ |
| `--episodes`                    | 2000                    | 自己対戦のエピソード数                                       |
| `--out`                         | `models/othello_dqn.pt` | 保存先                                                       |
| `--resume PATH`                 | –                       | チェックポイントから再開                                     |
| `--train-every`                 | 4                       | 環境ステップ何回ごとに勾配更新するか（CPU では大きめが速い） |
| `--eval-every` / `--eval-games` | 200 / 20                | 対ランダム評価の頻度と対局数                                 |
| `--eps-decay-steps`             | 50000                   | ε-greedy の減衰ステップ数                                    |

主なオプション（AlphaZero: `python -m uge_rl.train_az --help`）:

| オプション                | 既定値 | 説明                                                                     |
| ------------------------- | ------ | ------------------------------------------------------------------------ |
| `--iterations`            | 30     | イテレーション数                                                         |
| `--games-per-iter`        | 20     | 1 イテレーションの自己対戦局数                                           |
| `--simulations`           | 100    | 自己対戦時の 1 手あたり探索回数                                          |
| `--sim-batch`             | 16     | 1 回の `BatchSimulate` で展開する葉の数（大きいほど RPC が減る）         |
| `--train-steps-per-iter`  | 200    | 1 イテレーションの勾配更新回数                                           |
| `--eval-simulations`      | 25     | 評価・対局時の探索回数                                                   |
| `--temp-moves`            | 10     | 序盤この手数までは温度 1 でサンプリング（以降 argmax）                   |
| `--max-moves`             | 0      | 1 局の手数上限（0 = 無制限）。超えたら引き分けとして打ち切る             |
| `--dirichlet-alpha`       | 0.3    | ルートノイズの Dirichlet α（合法手が多い将棋は 0.15 程度、チェスは 0.3） |
| `--channels` / `--blocks` | 64 / 4 | ResNet の幅と深さ                                                        |

`--max-moves` は DQN（`train.py`）と `evaluate.py` にもあります（評価時は省略するとチェックポイントの設定を使う）。

## 学習済みモデルと対局する（`serve.py`）

学習したモデルを、フロントエンドで作った部屋の **☁️ gRPC External (`grpc_bot`)** 席の指し手として動かします。

```bash
task rl                                    # バックエンド（RL_MODE=true）。AlphaZero の MCTS が使う Simulate はこのモードでだけ有効
cd apps/frontend && bun dev                # フロントエンド
cd apps/ml && python -m uge_rl.serve --checkpoint ../../models/shogi_az.pt   # = task ml:serve
```

フロントエンドで将棋の「カスタムマッチ」→ 相手を **☁️ gRPC External** にして部屋を作ると、`serve` が
`GET /rooms/<game_type>` で `grpc_bot` の席を見つけ、gRPC `WaitForTurn` で手番を待ち、モデルで選んだ手を `SubmitTurn` で指します。
同じゲーム種別の部屋なら何部屋でも同時に担当します（思考は 1 局ずつ直列）。

| オプション      | 既定値                  | 説明                                                           |
| --------------- | ----------------------- | -------------------------------------------------------------- |
| `--checkpoint`  | –                       | `.pt`（`game_type` はチェックポイントから読む）                |
| `--address`     | `localhost:50051`       | バックエンドの gRPC                                            |
| `--http`        | `http://localhost:3000` | バックエンドの HTTP（部屋一覧の取得用）                        |
| `--simulations` | チェックポイントの設定  | AlphaZero の探索回数。`0` で policy head の argmax（探索なし） |
| `--game-id`     | –                       | 指定した部屋だけを担当する                                     |

通常モード（`RL_MODE` なし）のバックエンドに繋ぐと `Simulate` が `PERMISSION_DENIED` になるため、その場合は自動的に探索なしへ切り替えます。
DQN のチェックポイントは常に探索なし（Q 値の argmax）です。

## モデルの保存形式

`save_checkpoint()` は 1 つの `.pt` に `model_state`（state_dict）と `meta` を保存し、同名の `.json` にもメタ情報を書き出します。

```python
from uge_rl.checkpoint import load_checkpoint
agent, meta = load_checkpoint("models/othello_dqn.pt")
action_id = agent.greedy(obs, legal_action_ids)   # obs: サーバーの state_tensor
```

`meta` には `format`（`uge-rl/dqn/v1` / `uge-rl/az/v1`）, `game_type`, `obs_dim`, `obs_shape`, `n_actions`, `arch`, `config`, `eval_history`, `git_commit` などが入ります。どちらのエージェントも `select_action(obs, legal, state_json, player_id, env)` で手を返すので、評価コードは共通です。

## 木探索用 API（Simulate）

`GrpcGameEnv.simulate()` / `simulate_batch()` は、セッションの実局面に触れずに「任意の局面に 1 手適用した結果」を返します（MCTS などの木探索用）。局面は `reset()` / `step()` 後の `env.state_json`（または各 `StepResult.state_json`）をそのまま渡します。中身を解釈する必要はありません。

```python
obs, legal, active = env.reset()
root = env.state_json
children = env.simulate_batch([(root, active[0], int(a)) for a in legal])  # 全合法手を一括展開
for res in children:
    assert res.ok, res.error          # 不正な手は例外ではなく res.error で返る
    res.state_json, res.obs, res.legal_actions, res.reward, res.done
```

スループットの目安（ローカル、`python scripts/bench_simulate.py`）: 単発 ≈ 1,500 sims/s、`simulate_batch` x64 ≈ 10,000 sims/s。RPC 往復が支配的なので、木探索では展開するノードをまとめて `simulate_batch` に渡してください。

## 学習の仕組み

### AlphaZero 風（`train_az.py`）

- **探索 (`mcts.py`)**: PUCT。葉を `sim-batch` 個まとめて選び（virtual loss で重複を抑制）、1 回の `BatchSimulate` で展開、1 回の NN 推論で評価してバックアップする。部分木は次の手に再利用。ルートには Dirichlet ノイズ
- **符号規約**: `Node.player` はそのノードの手番。NN の value と obs はその視点。終局ノードは「最後に指した側」を `player` とし、その視点の報酬を value に持つ。バックアップは経路上の各ノードで `player` が一致すれば `+v`、違えば `-v`（パスがあっても正しく動く）
- **自己対戦 (`az_agent.py`)**: 局面は `Simulate` の結果だけで進める（`Step` は使わない）。各局面の (obs, 訪問回数分布 π, 手番) を記録し、終局後に手番視点の結果 z を付けてバッファへ
- **学習**: `loss = CE(π, policy logits[合法手のみ]) + MSE(z, value)`
- **対局 (`select_action`)**: ノイズなし・温度 0 で `eval_simulations` 回探索して最善手
- **手数上限 (`max_moves`)**: 超えた自己対戦は引き分け（全局面の z = 0）として打ち切る。将棋のように弱いうちは終局しないゲームで使う

### DQN（`train.py`）

- サーバーの `Step` は「次に行動するプレイヤー視点」の観測と合法手を返すので、1 つの Q ネットワークで両者を担当します。
- TD ターゲットはネガマックス形式: `y = r + γ · sign · max_a' Q_target(s', a')`（`sign = -1` 相手番 / `+1` パスで自分の番）。
- 終局時は、最後に指した側に `r`、その相手の最後の遷移に `-r` を書き戻します（引き分けは 0）。
- 観測: 8×8 の `{自分=+1, 相手=-1, 空=0}` → `(2, 8, 8)` プレーン → 小さな CNN → 64 個の Q 値。合法手以外は `-inf` でマスク。

### 将棋の観測と行動（`ShogiTensorAdapter` / `games.py`）

- **観測（95 要素）**: 自分視点の盤面 81 マス（後手は 180 度回転。自分の駒 = +駒種 1〜14、相手の駒 = -駒種）+ 自分の持ち駒 7 枠 + 相手の持ち駒 7 枠（歩 香 桂 銀 金 角 飛の枚数）。
  `games.py` で駒種ごとの one-hot 28 プレーン + 持ち駒枚数（上限で正規化）を盤全体に敷いた 14 プレーン = `(42, 9, 9)` に展開する。
- **行動（2187 通り）**: `移動先マス（自分視点）× 27 + 種別`。種別は 0-9 が移動方向（上, 左上, 右上, 左, 右, 下, 左下, 右下, 桂左, 桂右）、10-19 が同方向 + 成り、20-26 が持ち駒を打つ（歩〜飛）。
  移動元は「移動先から方向を逆にたどって最初にある駒」なので符号化は合法手と 1 対 1（dlshogi と同じ方式）。投了・入玉宣言は行動空間に含めない。
- 終局はサーバーの `ShogiRuleset`（詰み・千日手・連続王手）に従う。弱いうちは終局しないので `--max-moves` で引き分け打ち切りにする。

### チェスの観測と行動（`ChessTensorAdapter` / `games.py`）

- **観測（71 要素）**: 自分視点の盤面 64 マス（黒は上下反転。180 度回転ではないので、キングサイド / クイーンサイドの左右が白と揃う。自分の駒 = +駒種 1〜6 = P N B R Q K、相手の駒 = -駒種）+ キャスリング権 4（自分 K / 自分 Q / 相手 K / 相手 Q）+ アンパッサンの対象マス 1（自分視点の index、なければ -1）+ 50 手ルールのカウンタ 1 + 現局面の同形回数 1。
  `games.py` で駒種ごとの one-hot 12 プレーン + キャスリング権・カウンタ（正規化）を盤全体に敷いた 6 プレーン + アンパッサンの one-hot 1 プレーン = `(19, 8, 8)` に展開する。
- **行動（1792 通り）**: `移動先マス（自分視点）× 28 + 種別`。種別は 0-7 が移動方向（上, 左上, 右上, 左, 右, 下, 左下, 右下。ポーンの前進・捕獲、キャスリング（キングが横 2 マス）も含む）、8-15 がナイトの 8 方向、16-27 がポーンの昇格（方向 上/左上/右上 × 駒種 Q/R/B/N）。
  移動元は将棋と同じく「移動先から方向を逆にたどって最初にある駒」（ナイト・昇格は 1 マス手前）なので合法手と 1 対 1。投了は行動空間に含めない。
- 終局はサーバーの `ChessRuleset`（チェックメイト・ステイルメイト・50 手ルール・三回同形・駒不足）に従う。ランダムに近いうちは長引くので `--max-moves` で引き分け打ち切りにする。

## 別のゲームを学習させるには

1. `packages/shared/ai/TensorAdapter/` に `IAITensorAdapter` を実装し、`TensorAdapter/index.ts` で登録する
2. `uge_rl/games.py` に `GameSpec`（観測 → NN 入力の整形、行動数）を追加する（未登録ゲームは 1 次元ベクトル + MLP、行動数 = 観測次元で動く）
3. `python -m uge_rl.train --game <game_type>`（学習したモデルは `uge_rl.serve` でそのまま対局相手になる）

## proto を変更したとき

```bash
pip install grpcio-tools
python apps/ml/scripts/gen_proto.py
```
