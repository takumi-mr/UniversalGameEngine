"""AlphaZero 風エージェント: Policy/Value ネット + MCTS（探索は gRPC Simulate）。"""

from __future__ import annotations

from collections import deque
from dataclasses import asdict, dataclass, field

import numpy as np
import torch
import torch.nn.functional as F

from .az_net import Evaluator, build_policy_value_net
from .env import GrpcGameEnv
from .games import GameSpec
from .mcts import MCTS, MCTSConfig, Node, select_action


@dataclass
class AZConfig:
    channels: int = 64
    blocks: int = 4
    lr: float = 1e-3
    weight_decay: float = 1e-4
    batch_size: int = 256
    buffer_size: int = 50_000  # 局面数
    train_steps_per_iter: int = 200
    games_per_iter: int = 20
    temp_moves: int = 10  # 序盤この手数までは温度 1 でサンプリング、以降は argmax
    eval_simulations: int = 25  # 評価・対局時（select_action）の探索回数
    mcts: MCTSConfig = field(default_factory=MCTSConfig)

    @classmethod
    def from_dict(cls, d: dict) -> "AZConfig":
        d = dict(d)
        mcts = d.pop("mcts", {})
        return cls(**d, mcts=MCTSConfig(**mcts))


@dataclass
class Sample:
    obs: np.ndarray
    policy: np.ndarray  # (n_actions,) 訪問回数分布
    legal_mask: np.ndarray  # (n_actions,) bool
    value: float  # obs の手番プレイヤー視点の最終結果


class AZAgent:
    FORMAT = "uge-rl/az/v1"

    def __init__(self, spec: GameSpec, obs_dim: int, config: AZConfig, device: str | None = None):
        self.spec = spec
        self.obs_dim = obs_dim
        self.cfg = config
        self.device = torch.device(device or ("cuda" if torch.cuda.is_available() else "cpu"))
        self.net = build_policy_value_net(spec, obs_dim, config.channels, config.blocks).to(self.device)
        self.optim = torch.optim.AdamW(self.net.parameters(), lr=config.lr, weight_decay=config.weight_decay)
        self.evaluator = Evaluator(self.net, spec, self.device)
        self.buffer: deque[Sample] = deque(maxlen=config.buffer_size)
        self.rng = np.random.default_rng()
        self.games_played = 0
        self.train_steps = 0

    # ------------------------------------------------------------------ 探索
    def mcts(self, env: GrpcGameEnv, n_simulations: int | None = None) -> MCTS:
        cfg = self.cfg.mcts
        if n_simulations is not None:
            cfg = MCTSConfig(**{**asdict(cfg), "n_simulations": n_simulations})
        return MCTS(env, self.evaluator, self.spec.n_actions, cfg)

    def select_action(self, obs: np.ndarray, legal: np.ndarray, state_json: str, player_id: str, env: GrpcGameEnv) -> int:
        """対局用（評価・実戦）: ノイズなし・温度 0 で探索して最善手を返す。"""
        mcts = self.mcts(env, self.cfg.eval_simulations)
        root = mcts.make_root(state_json, player_id, legal, obs)
        policy = mcts.run(root, add_noise=False)
        return select_action(policy, legal, 0.0, self.rng)

    def raw_policy_action(self, obs: np.ndarray, legal: np.ndarray) -> int:
        """探索なしで policy head の argmax（高速な弱い指し手。デバッグ用）。"""
        mask = np.zeros(self.spec.n_actions, dtype=bool)
        mask[legal] = True
        priors, _ = self.evaluator.evaluate(obs[None], mask[None])
        return int(np.argmax(np.where(mask, priors[0], -1.0)))

    # ------------------------------------------------------------------ 自己対戦
    def self_play_game(self, env: GrpcGameEnv) -> tuple[int, float]:
        """1 局自己対戦してバッファに追加する。(手数, 先手視点の結果) を返す。"""
        obs, legal, active = env.reset()
        mcts = self.mcts(env)
        root: Node = mcts.make_root(env.state_json, active[0], legal, obs)
        first_player = active[0]
        history: list[tuple[np.ndarray, np.ndarray, np.ndarray, str]] = []
        moves = 0

        while True:
            policy = mcts.run(root, add_noise=True)
            history.append((root.obs, policy, root.legal_mask(self.spec.n_actions), root.player))
            temp = 1.0 if moves < self.cfg.temp_moves else 0.0
            action = select_action(policy, root.legal, temp, self.rng)
            idx = int(np.where(root.legal == action)[0][0])
            child = root.children[idx]
            if child is None:
                # 探索回数が少なく未展開だった場合はその場で展開する
                res = env.simulate(root.state_json, root.player, action)
                if not res.ok:
                    raise RuntimeError(res.error)
                child = Node(
                    res.state_json,
                    root.player if res.done else (res.next_player or root.player),
                    res.legal_actions,
                    res.obs,
                    terminal=res.done,
                    value=res.reward,
                )
            moves += 1
            if child.terminal:
                # child.player は最後に指したプレイヤー、value はその視点の報酬
                last_mover, reward = child.player, child.value
                break
            root = child  # 部分木を再利用（ノイズは次の run で改めて加える）

        for obs_t, policy_t, mask_t, player_t in history:
            z = reward if player_t == last_mover else -reward
            self.buffer.append(Sample(obs_t, policy_t, mask_t, float(z)))
        self.games_played += 1
        first_result = reward if first_player == last_mover else -reward
        return moves, float(first_result)

    # ------------------------------------------------------------------ 学習
    def train_step(self) -> tuple[float, float] | None:
        if len(self.buffer) < self.cfg.batch_size:
            return None
        idx = self.rng.integers(0, len(self.buffer), size=self.cfg.batch_size)
        batch = [self.buffer[i] for i in idx]
        obs = np.stack([s.obs for s in batch])
        target_p = torch.as_tensor(np.stack([s.policy for s in batch]), device=self.device)
        mask = torch.as_tensor(np.stack([s.legal_mask for s in batch]), device=self.device)
        target_v = torch.as_tensor([s.value for s in batch], device=self.device, dtype=torch.float32)

        self.net.train()
        x = torch.as_tensor(self.spec.encode(obs.astype(np.float32)), device=self.device)
        logits, values = self.net(x)
        log_p = F.log_softmax(logits.masked_fill(~mask, float("-inf")), dim=1)
        # 合法手以外は target が 0 なので、-inf * 0 が NaN にならないよう置き換える
        log_p = torch.where(mask, log_p, torch.zeros_like(log_p))
        policy_loss = -(target_p * log_p).sum(dim=1).mean()
        value_loss = F.mse_loss(values, target_v)
        loss = policy_loss + value_loss

        self.optim.zero_grad()
        loss.backward()
        torch.nn.utils.clip_grad_norm_(self.net.parameters(), 5.0)
        self.optim.step()
        self.train_steps += 1
        return float(policy_loss.item()), float(value_loss.item())

    # ------------------------------------------------------------------ チェックポイント
    def checkpoint_meta(self) -> dict:
        return {
            "format": self.FORMAT,
            "game_type": self.spec.game_type,
            "obs_dim": self.obs_dim,
            "obs_shape": list(self.spec.obs_shape) if self.spec.obs_shape else None,
            "n_actions": self.spec.n_actions,
            "arch": type(self.net).__name__,
            "config": asdict(self.cfg),
            "games_played": self.games_played,
            "train_steps": self.train_steps,
            "buffer_size": len(self.buffer),
        }

    def state_dict(self) -> dict:
        return self.net.state_dict()

    def load_state(self, state: dict, meta: dict) -> None:
        self.net.load_state_dict(state)
        self.games_played = meta.get("games_played", 0)
        self.train_steps = meta.get("train_steps", 0)
