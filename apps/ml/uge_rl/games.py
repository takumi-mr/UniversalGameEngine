"""ゲームごとの観測エンコーディング定義。

サーバーの IAITensorAdapter が返す 1 次元テンソルを、ニューラルネット向けの形に整える。
新しいゲームを学習させるときは packages/shared/ai/adapters/ にアダプタを追加した上で、ここに GameSpec を足す。
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Callable

import numpy as np


@dataclass(frozen=True)
class GameSpec:
    game_type: str
    # (C, H, W) など。None なら 1 次元ベクトルとして MLP に流す
    obs_shape: tuple[int, ...] | None
    n_actions: int
    encode: Callable[[np.ndarray], np.ndarray]
    description: str = ""


def _othello_planes(obs: np.ndarray) -> np.ndarray:
    """64 要素の {-1,0,1} → (2, 8, 8) の {自分の石, 相手の石} プレーン。"""
    size = int(math.isqrt(obs.shape[-1]))
    board = obs.reshape(*obs.shape[:-1], size, size)
    own = (board == 1).astype(np.float32)
    opp = (board == -1).astype(np.float32)
    return np.stack([own, opp], axis=-3)


def make_othello_spec(size: int = 8) -> GameSpec:
    return GameSpec(
        game_type="othello",
        obs_shape=(2, size, size),
        n_actions=size * size,
        encode=_othello_planes,
        description=f"Othello {size}x{size}: obs=自分=+1/相手=-1 の盤面, action=y*size+x",
    )


_REGISTRY: dict[str, Callable[[int], GameSpec]] = {
    "othello": make_othello_spec,
}


def get_game_spec(game_type: str, obs_dim: int) -> GameSpec:
    """game_type と実際の観測次元から GameSpec を作る。未登録ゲームは MLP 用の汎用 spec。"""
    key = game_type.lower().replace("-", "_")
    if key in _REGISTRY:
        size = int(math.isqrt(obs_dim))
        if size * size != obs_dim:
            raise ValueError(f"{game_type}: obs_dim={obs_dim} is not a square board")
        return _REGISTRY[key](size)
    return GameSpec(
        game_type=key,
        obs_shape=None,
        n_actions=obs_dim,
        encode=lambda x: x.astype(np.float32),
        description=f"generic flat vector (dim={obs_dim})",
    )
