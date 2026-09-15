"""gRPC Simulate を使った PUCT モンテカルロ木探索（AlphaZero 風）。

ルールは Python 側に持たない。ノードの展開はすべてサーバーの `BatchSimulate` に委ね、
葉の評価は Policy/Value ネットで行う。往復回数を抑えるため、1 回のループで `batch_size` 個の葉を
virtual loss 付きで選び、まとめて展開・評価する。

価値の符号規約:
  - Node.player はそのノードで手番のプレイヤー。NN の value も obs も Node.player 視点。
  - 終局ノードは手番がないので、最後に指したプレイヤー（親の player）を Node.player とし、
    value にはそのプレイヤー視点の報酬を入れる。
  - 辺 (node, a) の W/Q は node.player 視点。バックアップ時は player が一致すれば +v、違えば -v。
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from .az_net import Evaluator
from .env import GrpcGameEnv


@dataclass
class MCTSConfig:
    n_simulations: int = 100
    batch_size: int = 16  # 1 回の simulate_batch / NN 推論でまとめて展開する葉の数
    c_puct: float = 1.5
    dirichlet_alpha: float = 0.3
    dirichlet_eps: float = 0.25
    virtual_loss: float = 1.0


class Node:
    __slots__ = (
        "state_json",
        "player",
        "legal",
        "obs",
        "priors",
        "N",
        "W",
        "children",
        "terminal",
        "value",
        "expanded",
    )

    def __init__(
        self,
        state_json: str,
        player: str,
        legal: np.ndarray,
        obs: np.ndarray,
        terminal: bool = False,
        value: float = 0.0,
    ):
        self.state_json = state_json
        self.player = player
        self.legal = np.asarray(legal, dtype=np.int64)
        self.obs = obs
        self.terminal = terminal
        self.value = value
        self.expanded = False
        n = len(self.legal)
        self.priors = np.zeros(n, dtype=np.float32)
        self.N = np.zeros(n, dtype=np.float32)
        self.W = np.zeros(n, dtype=np.float32)
        self.children: list[Node | None] = [None] * n

    def expand(self, priors_full: np.ndarray) -> None:
        p = priors_full[self.legal].astype(np.float32)
        s = p.sum()
        self.priors = p / s if s > 0 else np.full(len(self.legal), 1.0 / max(1, len(self.legal)), np.float32)
        self.expanded = True

    def visit_counts_full(self, n_actions: int) -> np.ndarray:
        out = np.zeros(n_actions, dtype=np.float32)
        out[self.legal] = self.N
        return out

    def legal_mask(self, n_actions: int) -> np.ndarray:
        m = np.zeros(n_actions, dtype=bool)
        m[self.legal] = True
        return m


class MCTS:
    def __init__(self, env: GrpcGameEnv, evaluator: Evaluator, n_actions: int, config: MCTSConfig):
        self.env = env
        self.evaluator = evaluator
        self.n_actions = n_actions
        self.cfg = config
        self.rng = np.random.default_rng()

    # ------------------------------------------------------------------ 公開 API
    def make_root(self, state_json: str, player: str, legal: np.ndarray, obs: np.ndarray) -> Node:
        return Node(state_json, player, legal, obs)

    def run(self, root: Node, add_noise: bool = True) -> np.ndarray:
        """root から n_simulations 回探索し、訪問回数分布 (n_actions,) を返す。"""
        if not root.expanded and not root.terminal:
            self._evaluate_and_expand([root])
        if add_noise and len(root.legal) > 1:
            noise = self.rng.dirichlet([self.cfg.dirichlet_alpha] * len(root.legal)).astype(np.float32)
            root.priors = (1 - self.cfg.dirichlet_eps) * root.priors + self.cfg.dirichlet_eps * noise

        done = 0
        while done < self.cfg.n_simulations:
            k = min(self.cfg.batch_size, self.cfg.n_simulations - done)
            self._run_batch(root, k)
            done += k

        counts = root.visit_counts_full(self.n_actions)
        total = counts.sum()
        return counts / total if total > 0 else root.legal_mask(self.n_actions).astype(np.float32) / len(root.legal)

    # ------------------------------------------------------------------ 内部
    def _select(self, root: Node) -> tuple[list[tuple[Node, int]], Node, int | None]:
        """PUCT で葉まで降りる。戻り値: (経路, 到達ノード, 未展開の辺 index or None)。virtual loss を経路に加える。"""
        path: list[tuple[Node, int]] = []
        node = root
        while True:
            if node.terminal:
                return path, node, None
            if not node.expanded:
                return path, node, None
            total = node.N.sum()
            q = np.divide(node.W, node.N, out=np.zeros_like(node.W), where=node.N > 0)
            u = self.cfg.c_puct * node.priors * np.sqrt(total + 1.0) / (1.0 + node.N)
            i = int(np.argmax(q + u))
            path.append((node, i))
            node.N[i] += self.cfg.virtual_loss
            node.W[i] -= self.cfg.virtual_loss
            child = node.children[i]
            if child is None:
                return path, node, i
            node = child

    def _backup(self, path: list[tuple[Node, int]], value: float, value_player: str) -> None:
        for node, i in path:
            node.N[i] += 1.0 - self.cfg.virtual_loss
            node.W[i] += self.cfg.virtual_loss + (value if node.player == value_player else -value)

    def _revert(self, path: list[tuple[Node, int]]) -> None:
        for node, i in path:
            node.N[i] -= self.cfg.virtual_loss
            node.W[i] += self.cfg.virtual_loss

    def _evaluate_and_expand(self, nodes: list[Node]) -> np.ndarray:
        obs = np.stack([n.obs for n in nodes])
        masks = np.stack([n.legal_mask(self.n_actions) for n in nodes])
        priors, values = self.evaluator.evaluate(obs, masks)
        for node, p in zip(nodes, priors):
            node.expand(p)
        return values

    def _run_batch(self, root: Node, k: int) -> None:
        pending: list[tuple[list[tuple[Node, int]], Node, int]] = []
        seen: set[tuple[int, int]] = set()

        for _ in range(k):
            path, node, idx = self._select(root)
            if idx is None:
                # 終局ノード（または未展開のルート）に到達
                if node.terminal:
                    self._backup(path, node.value, node.player)
                else:
                    v = self._evaluate_and_expand([node])[0]
                    self._backup(path, float(v), node.player)
                continue
            key = (id(node), idx)
            if key in seen:
                # 同じ辺を同一バッチ内で二重に展開しない（virtual loss を戻して捨てる）
                self._revert(path)
                continue
            seen.add(key)
            pending.append((path, node, idx))

        if not pending:
            return

        results = self.env.simulate_batch(
            [(node.state_json, node.player, int(node.legal[idx])) for _, node, idx in pending]
        )

        to_eval: list[tuple[list[tuple[Node, int]], Node]] = []
        for (path, node, idx), res in zip(pending, results):
            if not res.ok:
                raise RuntimeError(f"simulate failed: {res.error}")
            if res.done:
                child = Node(res.state_json, node.player, np.empty(0, np.int64), res.obs, terminal=True, value=res.reward)
                node.children[idx] = child
                self._backup(path, child.value, child.player)
            else:
                child = Node(res.state_json, res.next_player or node.player, res.legal_actions, res.obs)
                node.children[idx] = child
                to_eval.append((path, child))

        if to_eval:
            values = self._evaluate_and_expand([c for _, c in to_eval])
            for (path, child), v in zip(to_eval, values):
                self._backup(path, float(v), child.player)


def select_action(policy: np.ndarray, legal: np.ndarray, temperature: float, rng: np.random.Generator) -> int:
    """訪問回数分布から手を選ぶ。temperature=0 なら argmax。"""
    p = policy[legal]
    if temperature <= 1e-6 or p.sum() <= 0:
        return int(legal[int(np.argmax(p))])
    p = p ** (1.0 / temperature)
    p = p / p.sum()
    return int(rng.choice(legal, p=p))
