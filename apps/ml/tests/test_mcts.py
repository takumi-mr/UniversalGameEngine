"""MCTS のバックアップ規約（符号・virtual loss の復元・終局処理）を、サーバーなしで検証する。

    cd apps/ml && python -m pytest tests -q     # pytest
    cd apps/ml && python -m tests.test_mcts     # 素の python でも動く

ゲーム: 2 人交互手番の「数当て」。状態は (残り手数, 手番) で、行動 0 か 1 を選ぶ。
残り手数が 0 になったら終局。最後に指したプレイヤーが行動 1 を選んでいれば勝ち (+1)、0 なら負け (-1)。
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from uge_rl.env import StepResult  # noqa: E402
from uge_rl.mcts import MCTS, MCTSConfig, Node, select_action  # noqa: E402

N_ACTIONS = 2
PLAYERS = ("A", "B")


def _obs(remaining: int, player: str) -> np.ndarray:
    return np.array([remaining, 1.0 if player == "A" else -1.0], dtype=np.float32)


class FakeEnv:
    """GrpcGameEnv.simulate_batch と同じ契約を満たすダミー。"""

    def __init__(self) -> None:
        self.calls = 0

    def simulate_batch(self, items):
        self.calls += 1
        out = []
        for state_json, player_id, action_id in items:
            st = json.loads(state_json)
            assert st["player"] == player_id, "手番でないプレイヤーの手"
            remaining = st["remaining"] - 1
            other = "B" if player_id == "A" else "A"
            if remaining == 0:
                reward = 1.0 if action_id == 1 else -1.0
                out.append(
                    StepResult(
                        obs=_obs(0, player_id),
                        legal_actions=np.empty(0, np.int64),
                        reward=reward,
                        done=True,
                        active_players=[],
                        state_json=json.dumps({"remaining": 0, "player": player_id}),
                    )
                )
            else:
                out.append(
                    StepResult(
                        obs=_obs(remaining, other),
                        legal_actions=np.array([0, 1], np.int64),
                        reward=0.0,
                        done=False,
                        active_players=[other],
                        state_json=json.dumps({"remaining": remaining, "player": other}),
                    )
                )
        return out

    def simulate(self, state_json, player_id, action_id):
        return self.simulate_batch([(state_json, player_id, action_id)])[0]


class UniformEvaluator:
    """一様な事前確率・価値 0 を返す（探索が報酬だけから学ぶ状況を作る）。"""

    def evaluate(self, obs_batch, legal_masks):
        priors = legal_masks.astype(np.float32)
        priors /= priors.sum(axis=1, keepdims=True)
        return priors, np.zeros(len(obs_batch), dtype=np.float32)


def make_root(remaining: int, player: str = "A") -> Node:
    return Node(json.dumps({"remaining": remaining, "player": player}), player, np.array([0, 1]), _obs(remaining, player))


def test_terminal_reward_backs_up_to_mover() -> None:
    """残り 1 手: 行動 1 で勝ち。探索後は行動 1 の訪問が多く Q > 0 であること。"""
    mcts = MCTS(FakeEnv(), UniformEvaluator(), N_ACTIONS, MCTSConfig(n_simulations=40, batch_size=8))
    root = make_root(1)
    policy = mcts.run(root, add_noise=False)
    assert policy[1] > policy[0]
    q = root.W / np.maximum(root.N, 1)
    assert q[1] > 0 > q[0]


def test_opponent_win_is_negative_for_root() -> None:
    """残り 2 手: 自分が何を指しても、相手が最後に行動 1 を選べば相手の勝ち。
    ルート（自分）から見た Q は両方の手で負になること（相手の最善手が正しく符号反転して伝わる）。"""
    env = FakeEnv()
    mcts = MCTS(env, UniformEvaluator(), N_ACTIONS, MCTSConfig(n_simulations=200, batch_size=16))
    root = make_root(2)
    mcts.run(root, add_noise=False)
    q = root.W / np.maximum(root.N, 1)
    assert (q < 0).all(), q
    # 子（相手）ノードでは行動 1 の Q が正
    for child in root.children:
        assert child is not None and child.expanded
        cq = child.W / np.maximum(child.N, 1)
        assert cq[1] > cq[0]


def test_virtual_loss_is_reverted() -> None:
    """探索後、各辺の N は整数（virtual loss が残っていない）で、合計が simulations 以下であること。"""
    env = FakeEnv()
    mcts = MCTS(env, UniformEvaluator(), N_ACTIONS, MCTSConfig(n_simulations=64, batch_size=16))
    root = make_root(3)
    mcts.run(root, add_noise=False)

    def walk(node: Node):
        assert np.allclose(node.N, np.round(node.N)), node.N
        for c in node.children:
            if c is not None and not c.terminal:
                walk(c)

    walk(root)
    assert root.N.sum() <= 64


def test_batching_reduces_rpc_calls() -> None:
    env = FakeEnv()
    mcts = MCTS(env, UniformEvaluator(), N_ACTIONS, MCTSConfig(n_simulations=64, batch_size=16))
    mcts.run(make_root(6), add_noise=False)
    assert env.calls <= 64 // 16 + 1


def test_select_action_temperature() -> None:
    rng = np.random.default_rng(0)
    legal = np.array([3, 7])
    policy = np.zeros(10)
    policy[3], policy[7] = 0.9, 0.1
    assert select_action(policy, legal, 0.0, rng) == 3
    picks = {select_action(policy, legal, 1.0, rng) for _ in range(200)}
    assert picks == {3, 7}


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            print("ok", name)
