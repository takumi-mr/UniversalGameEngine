# 🧠 apps/ml — 強化学習クライアント (Python)

Universal Game Engine の gRPC RL API（`Reset` / `Step`）を使って、ゲーム AI を自己対戦で学習させる Python パッケージです。
オセロ用に **DQN**（Double DQN + 合法手マスク）と **AlphaZero 風**（Policy/Value ネット + MCTS、探索は gRPC `BatchSimulate`）の 2 方式を実装しています。

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
│   └── evaluate.py    # 評価 CLI（対ランダム勝率）。両方式共通
├── tests/test_mcts.py # MCTS のバックアップ規約の単体テスト（サーバー不要）
├── proto/             # game.proto から生成した Python スタブ（コミット済み）
├── scripts/gen_proto.py            # proto から Python スタブを再生成
├── scripts/bench_simulate.py       # Simulate / BatchSimulate のスループット計測
├── notebooks/othello_dqn_colab.ipynb        # Google Colab 用ノートブック (DQN)
├── notebooks/othello_alphazero_colab.ipynb  # Google Colab 用ノートブック (AlphaZero)
└── requirements.txt
```

## Google Colab で学習する（推奨）

[notebooks/othello_dqn_colab.ipynb](./notebooks/othello_dqn_colab.ipynb)（DQN）または [notebooks/othello_alphazero_colab.ipynb](./notebooks/othello_alphazero_colab.ipynb)（AlphaZero）を Colab で開き、上から順に実行してください。
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

# 4. 評価（どちらの形式でも同じコマンド。format を見て復元する）
python -m uge_rl.evaluate --checkpoint ../../models/othello_az.pt --games 100

# 5. MCTS の単体テスト（サーバー不要）
python -m tests.test_mcts
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

| オプション                | 既定値 | 説明                                                             |
| ------------------------- | ------ | ---------------------------------------------------------------- |
| `--iterations`            | 30     | イテレーション数                                                 |
| `--games-per-iter`        | 20     | 1 イテレーションの自己対戦局数                                   |
| `--simulations`           | 100    | 自己対戦時の 1 手あたり探索回数                                  |
| `--sim-batch`             | 16     | 1 回の `BatchSimulate` で展開する葉の数（大きいほど RPC が減る） |
| `--train-steps-per-iter`  | 200    | 1 イテレーションの勾配更新回数                                   |
| `--eval-simulations`      | 25     | 評価・対局時の探索回数                                           |
| `--temp-moves`            | 10     | 序盤この手数までは温度 1 でサンプリング（以降 argmax）           |
| `--channels` / `--blocks` | 64 / 4 | ResNet の幅と深さ                                                |

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

### DQN（`train.py`）

- サーバーの `Step` は「次に行動するプレイヤー視点」の観測と合法手を返すので、1 つの Q ネットワークで両者を担当します。
- TD ターゲットはネガマックス形式: `y = r + γ · sign · max_a' Q_target(s', a')`（`sign = -1` 相手番 / `+1` パスで自分の番）。
- 終局時は、最後に指した側に `r`、その相手の最後の遷移に `-r` を書き戻します（引き分けは 0）。
- 観測: 8×8 の `{自分=+1, 相手=-1, 空=0}` → `(2, 8, 8)` プレーン → 小さな CNN → 64 個の Q 値。合法手以外は `-inf` でマスク。

## 別のゲームを学習させるには

1. `packages/shared/ai/TensorAdapter/` に `IAITensorAdapter` を実装し、`TensorAdapter/index.ts` で登録する
2. `uge_rl/games.py` に `GameSpec`（観測 → NN 入力の整形）を追加する（未登録ゲームは 1 次元ベクトル + MLP で動く）
3. `python -m uge_rl.train --game <game_type>`

## proto を変更したとき

```bash
pip install grpcio-tools
python apps/ml/scripts/gen_proto.py
```
