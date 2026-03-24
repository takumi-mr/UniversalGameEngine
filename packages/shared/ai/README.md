# Universal Game Engine: Shared AI package

このパッケージは、ユニバーサルゲームエンジンで使用されるAIプレイヤーおよび探索アルゴリズムの共通インターフェースと、いくつかの標準的な実装を提供します。

## インターフェース

### [IAIPlayer.ts](./IAIPlayer.ts)

すべてのAI・探索ソルバーが実装すべき共通インターフェースです。
主なメソッド:

- `computeNextMove(state, legalActions, options)`: 現在の状態と合法手を受け取り、次に実行するアクションを非同期で返します。

### [IAITensorAdapter.ts](./IAITensorAdapter.ts)

ゲームの状態をニューラルネットワーク等に入力可能なテンソル形式に変換するためのアダプターインターフェースです。

## 実装済みAIプレイヤー

### [RandomPlayer.ts](./RandomPlayer.ts)

合法手の中からランダムに手を選択するシンプルなAIです。ベースラインやテスト用に使用されます。

### [MinimaxPlayer.ts](./MinimaxPlayer.ts)

ミニマックス法（およびαβ枝刈り）を用いた探索型AIです。確定完全情報ゲームに適しています。

### [MCTSPlayer.ts](./MCTSPlayer.ts)

モンテカルロ木探索 (MCTS) を用いた探索型AIです。盤面評価関数を定義しにくいゲームや、探索空間が広いゲームに適しています。

### [GrpcBotPlayer.ts](./GrpcBotPlayer.ts)

決定権を外部のgRPCサーバーに委譲するAIプレイヤーです。Python (PyTorch/TensorFlow) 等で実装されたモデルと連携する際に使用します。

### [LLMPlayer.ts](./LLMPLayer.ts)

LLM（Large Language Model）を使用してゲームの指し手を決定するAIプレイヤーです。プロンプトエンジニアリングを用いてゲーム状態を言語化し、LLMの推論能力を活用します。

## ユーティリティ

### [AITensorAdapterRegistry.ts](./AITensorAdapterRegistry.ts)

各ゲームに応じた `IAITensorAdapter` を管理するためのレジストリです。

## テスト

各AIの実装には対応する `.test.ts` ファイルが含まれており、基本的な動作や探索の品質を確認できます。
