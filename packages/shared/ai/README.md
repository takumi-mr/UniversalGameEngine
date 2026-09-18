# Universal Game Engine: Shared AI package

このパッケージは、ユニバーサルゲームエンジンで使用されるAIプレイヤーおよび探索アルゴリズムの共通インターフェースと、いくつかの標準的な実装を提供します。

## インターフェース

### [IAIPlayer.ts](./IAIPlayer.ts)

すべてのAI・探索ソルバーが実装すべき共通インターフェースです。
主なメソッド:

- `computeNextMove(state, legalActions, options)`: 現在の状態と合法手を受け取り、次に実行するアクションを非同期で返します。

### [IAITensorAdapter.ts](./IAITensorAdapter.ts)

ゲームの状態をニューラルネットワーク等に入力可能なテンソル形式に変換するためのアダプターインターフェースです。

## 実装済みAIプレイヤー ([AIPlayer/](./AIPlayer/))

### [RandomPlayer.ts](./AIPlayer/RandomPlayer.ts)

合法手の中からランダムに手を選択するシンプルなAIです。ベースラインやテスト用に使用されます。

### [MinimaxPlayer.ts](./AIPlayer/MinimaxPlayer.ts)

ミニマックス法（およびαβ枝刈り）を用いた探索型AIです。確定完全情報ゲームに適しています。

### [MCTSPlayer.ts](./AIPlayer/MCTSPlayer.ts)

モンテカルロ木探索 (MCTS) を用いた探索型AIです。盤面評価関数を定義しにくいゲームや、探索空間が広いゲームに適しています。

### [GrpcBotPlayer.ts](./AIPlayer/GrpcBotPlayer.ts)

決定権を外部のgRPCサーバーに委譲するAIプレイヤーです。Python (PyTorch/TensorFlow) 等で実装されたモデルと連携する際に使用します。

### [LLMPlayer.ts](./AIPlayer/LLMPLayer.ts)

LLM（Large Language Model）を使用してゲームの指し手を決定するAIプレイヤーです。プロンプトエンジニアリングを用いてゲーム状態を言語化し、LLMの推論能力を活用します。

## ユーティリティ

### [AITensorAdapterRegistry.ts](./AITensorAdapterRegistry.ts)

各ゲームに応じた `IAITensorAdapter` を管理するためのレジストリです。

### [TensorAdapter/](./TensorAdapter/)

組み込みの `IAITensorAdapter` 実装と、それらを `aiTensorRegistry` に登録する `index.ts`。gRPC の `Reset`/`Step`（強化学習ループ）と `WaitForTurn`/`SubmitTurn`（実対局の外部ボット）はここに登録されたゲームでのみ使えます。学習側のコードは [`apps/ml`](../../../apps/ml/README.md) を参照。

| アダプタ                                                           | ゲーム               | 観測                                                                           | 行動 ID                                                                       |
| ------------------------------------------------------------------ | -------------------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| [OthelloTensorAdapter.ts](./TensorAdapter/OthelloTensorAdapter.ts) | `othello`            | `size*size`（自分=+1 / 相手=-1 / 空=0）                                        | `y * size + x`                                                                |
| [ShogiTensorAdapter.ts](./TensorAdapter/ShogiTensorAdapter.ts)     | `shogi` / `shogi_3d` | 95 = 自分視点の盤 81（後手は 180 度回転。自分=+駒種 / 相手=-駒種）+ 持ち駒 7×2 | `移動先マス × 27 + 種別`（0-9 移動方向 / 10-19 成り / 20-26 打つ）= 2187 通り |

## テスト

各AIの実装には対応する `.test.ts` ファイルが含まれており、基本的な動作や探索の品質を確認できます。
