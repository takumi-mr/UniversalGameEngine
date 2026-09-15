"""AlphaZero 風の Policy / Value ネットワーク。

入力: GameSpec.encode で整形した観測（手番プレイヤー視点）
出力: policy logits (n_actions) と value (tanh, 手番プレイヤーから見た期待結果 -1..1)
"""

from __future__ import annotations

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F

from .games import GameSpec


class ResBlock(nn.Module):
    def __init__(self, ch: int):
        super().__init__()
        self.c1 = nn.Conv2d(ch, ch, 3, padding=1, bias=False)
        self.b1 = nn.BatchNorm2d(ch)
        self.c2 = nn.Conv2d(ch, ch, 3, padding=1, bias=False)
        self.b2 = nn.BatchNorm2d(ch)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        y = F.relu(self.b1(self.c1(x)))
        y = self.b2(self.c2(y))
        return F.relu(x + y)


class ConvPolicyValueNet(nn.Module):
    """盤面ゲーム用。入力 (B, C, H, W)。"""

    def __init__(self, in_channels: int, height: int, width: int, n_actions: int, channels: int = 64, blocks: int = 4):
        super().__init__()
        self.stem = nn.Sequential(
            nn.Conv2d(in_channels, channels, 3, padding=1, bias=False),
            nn.BatchNorm2d(channels),
            nn.ReLU(),
        )
        self.blocks = nn.Sequential(*[ResBlock(channels) for _ in range(blocks)])
        self.policy_head = nn.Sequential(
            nn.Conv2d(channels, 2, 1, bias=False),
            nn.BatchNorm2d(2),
            nn.ReLU(),
            nn.Flatten(),
            nn.Linear(2 * height * width, n_actions),
        )
        self.value_head = nn.Sequential(
            nn.Conv2d(channels, 1, 1, bias=False),
            nn.BatchNorm2d(1),
            nn.ReLU(),
            nn.Flatten(),
            nn.Linear(height * width, 64),
            nn.ReLU(),
            nn.Linear(64, 1),
            nn.Tanh(),
        )

    def forward(self, x: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor]:
        h = self.blocks(self.stem(x))
        return self.policy_head(h), self.value_head(h).squeeze(-1)


class MlpPolicyValueNet(nn.Module):
    """観測が 1 次元ベクトルのゲーム用。"""

    def __init__(self, obs_dim: int, n_actions: int, hidden: int = 256):
        super().__init__()
        self.trunk = nn.Sequential(
            nn.Linear(obs_dim, hidden), nn.ReLU(), nn.Linear(hidden, hidden), nn.ReLU()
        )
        self.policy_head = nn.Linear(hidden, n_actions)
        self.value_head = nn.Sequential(nn.Linear(hidden, 64), nn.ReLU(), nn.Linear(64, 1), nn.Tanh())

    def forward(self, x: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor]:
        h = self.trunk(x)
        return self.policy_head(h), self.value_head(h).squeeze(-1)


def build_policy_value_net(spec: GameSpec, obs_dim: int, channels: int = 64, blocks: int = 4) -> nn.Module:
    if spec.obs_shape is not None and len(spec.obs_shape) == 3:
        c, h, w = spec.obs_shape
        return ConvPolicyValueNet(c, h, w, spec.n_actions, channels=channels, blocks=blocks)
    return MlpPolicyValueNet(obs_dim, spec.n_actions)


class Evaluator:
    """MCTS から呼ばれる NN 推論のラッパー。観測のバッチ → (合法手で正規化した事前確率, 価値)。"""

    def __init__(self, net: nn.Module, spec: GameSpec, device: torch.device):
        self.net = net
        self.spec = spec
        self.device = device

    @torch.no_grad()
    def evaluate(self, obs_batch: np.ndarray, legal_masks: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        """obs_batch: (B, obs_dim), legal_masks: (B, n_actions) bool → priors (B, n_actions), values (B,)"""
        was_training = self.net.training
        self.net.eval()
        x = torch.as_tensor(self.spec.encode(obs_batch.astype(np.float32)), device=self.device)
        logits, values = self.net(x)
        mask = torch.as_tensor(legal_masks, device=self.device)
        logits = logits.masked_fill(~mask, float("-inf"))
        priors = torch.softmax(logits, dim=1)
        if was_training:
            self.net.train()
        return priors.cpu().numpy(), values.cpu().numpy()
