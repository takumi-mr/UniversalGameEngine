"""2 人ゼロサムゲーム向け DQN（自己対戦・ネガマックス形式）。

1 つの Q ネットワークで両プレイヤーを担当する。観測は常に「手番プレイヤー視点」なので、
次状態の価値は相手視点になる。そのため TD ターゲットは

    y = r + gamma * sign * max_a' Q_target(s', a')   (sign = -1: 次は相手の手番, +1: パスで自分の手番)

とする。終局時は y = r。合法手以外は -inf でマスクして argmax / max を取る。
"""

from __future__ import annotations

import random
from dataclasses import asdict, dataclass
from typing import TYPE_CHECKING

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F

from .games import GameSpec

if TYPE_CHECKING:
    from .env import GrpcGameEnv


# ---------------------------------------------------------------------- ネットワーク
class ConvQNet(nn.Module):
    """盤面ゲーム用の小さな CNN。入力 (B, C, H, W) → 出力 (B, n_actions)。"""

    def __init__(self, in_channels: int, height: int, width: int, n_actions: int, hidden: int = 128):
        super().__init__()
        self.conv = nn.Sequential(
            nn.Conv2d(in_channels, 64, 3, padding=1),
            nn.ReLU(),
            nn.Conv2d(64, 64, 3, padding=1),
            nn.ReLU(),
            nn.Conv2d(64, 32, 3, padding=1),
            nn.ReLU(),
        )
        self.head = nn.Sequential(
            nn.Flatten(),
            nn.Linear(32 * height * width, hidden),
            nn.ReLU(),
            nn.Linear(hidden, n_actions),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.head(self.conv(x))


class MlpQNet(nn.Module):
    """観測が 1 次元ベクトルのゲーム用。"""

    def __init__(self, obs_dim: int, n_actions: int, hidden: int = 256):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(obs_dim, hidden),
            nn.ReLU(),
            nn.Linear(hidden, hidden),
            nn.ReLU(),
            nn.Linear(hidden, n_actions),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.net(x)


def build_qnet(spec: GameSpec, obs_dim: int) -> nn.Module:
    if spec.obs_shape is not None and len(spec.obs_shape) == 3:
        c, h, w = spec.obs_shape
        return ConvQNet(c, h, w, spec.n_actions)
    return MlpQNet(obs_dim, spec.n_actions)


# ---------------------------------------------------------------------- リプレイバッファ
class ReplayBuffer:
    """固定長リングバッファ。終局時に相手側の最後の遷移を書き換えるため index を返す。"""

    def __init__(self, capacity: int, obs_dim: int, n_actions: int):
        self.capacity = capacity
        self.obs = np.zeros((capacity, obs_dim), dtype=np.float32)
        self.action = np.zeros(capacity, dtype=np.int64)
        self.reward = np.zeros(capacity, dtype=np.float32)
        self.next_obs = np.zeros((capacity, obs_dim), dtype=np.float32)
        self.next_mask = np.zeros((capacity, n_actions), dtype=bool)
        self.done = np.zeros(capacity, dtype=bool)
        self.sign = np.zeros(capacity, dtype=np.float32)
        self.pos = 0
        self.size = 0

    def add(
        self,
        obs: np.ndarray,
        action: int,
        reward: float,
        next_obs: np.ndarray,
        next_legal: np.ndarray,
        done: bool,
        sign: float,
    ) -> int:
        i = self.pos
        self.obs[i] = obs
        self.action[i] = action
        self.reward[i] = reward
        self.next_obs[i] = next_obs
        self.next_mask[i] = False
        self.next_mask[i, next_legal] = True
        self.done[i] = done
        self.sign[i] = sign
        self.pos = (self.pos + 1) % self.capacity
        self.size = min(self.size + 1, self.capacity)
        return i

    def set_terminal(self, index: int, reward: float) -> None:
        """終局時、相手側の最後の遷移を「終端・報酬 reward」に書き換える。"""
        self.reward[index] = reward
        self.done[index] = True

    def sample(self, batch_size: int) -> tuple[np.ndarray, ...]:
        idx = np.random.randint(0, self.size, size=batch_size)
        return (
            self.obs[idx],
            self.action[idx],
            self.reward[idx],
            self.next_obs[idx],
            self.next_mask[idx],
            self.done[idx],
            self.sign[idx],
        )


# ---------------------------------------------------------------------- エージェント
@dataclass
class DQNConfig:
    gamma: float = 0.99
    lr: float = 1e-3
    batch_size: int = 128
    buffer_size: int = 100_000
    warmup_steps: int = 1_000
    target_sync_every: int = 1_000
    eps_start: float = 1.0
    eps_end: float = 0.05
    eps_decay_steps: int = 50_000
    grad_clip: float = 10.0
    double_dqn: bool = True
    train_every: int = 4  # 環境ステップ何回ごとに勾配更新するか


class DQNAgent:
    FORMAT = "uge-rl/dqn/v1"

    def __init__(self, spec: GameSpec, obs_dim: int, config: DQNConfig, device: str | None = None):
        self.spec = spec
        self.obs_dim = obs_dim
        self.cfg = config
        self.device = torch.device(device or ("cuda" if torch.cuda.is_available() else "cpu"))

        self.q = build_qnet(spec, obs_dim).to(self.device)
        self.q_target = build_qnet(spec, obs_dim).to(self.device)
        self.q_target.load_state_dict(self.q.state_dict())
        self.q_target.eval()
        self.optim = torch.optim.Adam(self.q.parameters(), lr=config.lr)
        self.buffer = ReplayBuffer(config.buffer_size, obs_dim, spec.n_actions)
        self.total_steps = 0
        self.train_steps = 0

    # ---- 観測 → テンソル
    def _to_input(self, obs: np.ndarray) -> torch.Tensor:
        x = self.spec.encode(np.asarray(obs, dtype=np.float32))
        return torch.as_tensor(x, device=self.device)

    @property
    def epsilon(self) -> float:
        frac = min(1.0, self.total_steps / max(1, self.cfg.eps_decay_steps))
        return self.cfg.eps_start + frac * (self.cfg.eps_end - self.cfg.eps_start)

    @torch.no_grad()
    def q_values(self, obs: np.ndarray) -> np.ndarray:
        x = self._to_input(obs[None])
        return self.q(x)[0].cpu().numpy()

    def act(self, obs: np.ndarray, legal: np.ndarray, epsilon: float | None = None) -> int:
        eps = self.epsilon if epsilon is None else epsilon
        if random.random() < eps:
            return int(random.choice(legal.tolist()))
        return self.greedy(obs, legal)

    def greedy(self, obs: np.ndarray, legal: np.ndarray) -> int:
        q = self.q_values(obs)
        masked = np.full_like(q, -np.inf)
        masked[legal] = q[legal]
        return int(np.argmax(masked))

    def select_action(
        self, obs: np.ndarray, legal: np.ndarray, state_json: str, player_id: str, env: "GrpcGameEnv"
    ) -> int:
        """対局用の共通インターフェース（AZAgent と同じシグネチャ）。DQN は観測だけで決める。"""
        return self.greedy(obs, legal)

    # ---- チェックポイント
    def checkpoint_meta(self) -> dict:
        return {
            "format": self.FORMAT,
            "game_type": self.spec.game_type,
            "obs_dim": self.obs_dim,
            "obs_shape": list(self.spec.obs_shape) if self.spec.obs_shape else None,
            "n_actions": self.spec.n_actions,
            "arch": type(self.q).__name__,
            "config": asdict(self.cfg),
            "total_steps": self.total_steps,
            "train_steps": self.train_steps,
            "epsilon": self.epsilon,
        }

    def state_dict(self) -> dict:
        return self.q.state_dict()

    def load_state(self, state: dict, meta: dict) -> None:
        self.q.load_state_dict(state)
        self.q_target.load_state_dict(state)
        self.total_steps = meta.get("total_steps", 0)
        self.train_steps = meta.get("train_steps", 0)

    # ---- 学習
    def train_step(self) -> float | None:
        if self.buffer.size < max(self.cfg.warmup_steps, self.cfg.batch_size):
            return None

        obs, action, reward, next_obs, next_mask, done, sign = self.buffer.sample(self.cfg.batch_size)
        obs_t = self._to_input(obs)
        next_t = self._to_input(next_obs)
        action_t = torch.as_tensor(action, device=self.device)
        reward_t = torch.as_tensor(reward, device=self.device)
        mask_t = torch.as_tensor(next_mask, device=self.device)
        done_t = torch.as_tensor(done, device=self.device, dtype=torch.float32)
        sign_t = torch.as_tensor(sign, device=self.device)

        q_sa = self.q(obs_t).gather(1, action_t[:, None]).squeeze(1)

        with torch.no_grad():
            next_q_target = self.q_target(next_t).masked_fill(~mask_t, float("-inf"))
            if self.cfg.double_dqn:
                next_q_online = self.q(next_t).masked_fill(~mask_t, float("-inf"))
                best = next_q_online.argmax(dim=1, keepdim=True)
                next_v = next_q_target.gather(1, best).squeeze(1)
            else:
                next_v = next_q_target.max(dim=1).values
            # 終端 or 合法手なし（-inf）の行は bootstrap しない
            next_v = torch.where(torch.isfinite(next_v), next_v, torch.zeros_like(next_v))
            target = reward_t + (1.0 - done_t) * self.cfg.gamma * sign_t * next_v

        loss = F.smooth_l1_loss(q_sa, target)
        self.optim.zero_grad()
        loss.backward()
        nn.utils.clip_grad_norm_(self.q.parameters(), self.cfg.grad_clip)
        self.optim.step()

        self.train_steps += 1
        if self.train_steps % self.cfg.target_sync_every == 0:
            self.q_target.load_state_dict(self.q.state_dict())
        return float(loss.item())
