"""ゲームごとの観測エンコーディング定義。

サーバーの IAITensorAdapter が返す 1 次元テンソルを、ニューラルネット向けの形に整える。
新しいゲームを学習させるときは packages/shared/ai/TensorAdapter/ にアダプタを追加した上で、ここに GameSpec を足す。
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


# ---------------------------------------------------------------------- オセロ
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


def _othello_from_obs_dim(obs_dim: int) -> GameSpec:
    size = int(math.isqrt(obs_dim))
    if size * size != obs_dim:
        raise ValueError(f"othello: obs_dim={obs_dim} is not a square board")
    return make_othello_spec(size)


# ---------------------------------------------------------------------- 将棋
# ShogiTensorAdapter（packages/shared/ai/TensorAdapter/ShogiTensorAdapter.ts）の契約:
#   obs[0:81]  自分視点の盤面（後手は 180 度回転）。自分の駒 = +駒種 (1..14)、相手の駒 = -駒種、空 = 0
#   obs[81:88] 自分の持ち駒の枚数（歩 香 桂 銀 金 角 飛）
#   obs[88:95] 相手の持ち駒の枚数
#   action = 移動先マス（自分視点）× 27 + 種別（0-9 移動方向 / 10-19 移動 + 成り / 20-26 打つ）
SHOGI_BOARD = 9
SHOGI_SQUARES = SHOGI_BOARD * SHOGI_BOARD
SHOGI_PIECE_TYPES = 14
SHOGI_HAND_TYPES = 7
SHOGI_OBS_DIM = SHOGI_SQUARES + SHOGI_HAND_TYPES * 2  # 95
SHOGI_ACTION_KINDS = 27
SHOGI_N_ACTIONS = SHOGI_SQUARES * SHOGI_ACTION_KINDS  # 2187
# 持ち駒の枚数を [0,1] に正規化するための上限（歩 18, 香 4, 桂 4, 銀 4, 金 4, 角 2, 飛 2）
SHOGI_HAND_MAX = np.array([18, 4, 4, 4, 4, 2, 2], dtype=np.float32)
# 入力チャンネル: 自分の駒 14 + 相手の駒 14 + 自分の持ち駒 7 + 相手の持ち駒 7
SHOGI_CHANNELS = SHOGI_PIECE_TYPES * 2 + SHOGI_HAND_TYPES * 2  # 42


def _shogi_planes(obs: np.ndarray) -> np.ndarray:
    """95 要素の観測 → (42, 9, 9)。駒種ごとの one-hot プレーン + 持ち駒枚数を盤全体に敷いたプレーン。"""
    if obs.shape[-1] != SHOGI_OBS_DIM:
        raise ValueError(f"shogi: expected obs_dim={SHOGI_OBS_DIM}, got {obs.shape[-1]}")
    lead = obs.shape[:-1]
    board = obs[..., :SHOGI_SQUARES].reshape(*lead, SHOGI_BOARD, SHOGI_BOARD)
    own = np.stack([board == t for t in range(1, SHOGI_PIECE_TYPES + 1)], axis=-3)
    opp = np.stack([board == -t for t in range(1, SHOGI_PIECE_TYPES + 1)], axis=-3)
    hands = obs[..., SHOGI_SQUARES:] / np.concatenate([SHOGI_HAND_MAX, SHOGI_HAND_MAX])
    hand_planes = np.broadcast_to(hands[..., None, None], (*lead, SHOGI_HAND_TYPES * 2, SHOGI_BOARD, SHOGI_BOARD))
    return np.concatenate([own, opp, hand_planes], axis=-3).astype(np.float32)


def make_shogi_spec(game_type: str = "shogi") -> GameSpec:
    return GameSpec(
        game_type=game_type,
        obs_shape=(SHOGI_CHANNELS, SHOGI_BOARD, SHOGI_BOARD),
        n_actions=SHOGI_N_ACTIONS,
        encode=_shogi_planes,
        description=(
            "Shogi 9x9: obs=自分視点の盤面 81 + 持ち駒 7x2, "
            f"action=移動先 x {SHOGI_ACTION_KINDS} + 種別 ({SHOGI_N_ACTIONS} 通り)"
        ),
    )


def _shogi_from_obs_dim(game_type: str) -> Callable[[int], GameSpec]:
    def build(obs_dim: int) -> GameSpec:
        if obs_dim != SHOGI_OBS_DIM:
            raise ValueError(f"{game_type}: expected obs_dim={SHOGI_OBS_DIM}, got {obs_dim}")
        return make_shogi_spec(game_type)

    return build


# ---------------------------------------------------------------------- レジストリ
# game_type → (obs_dim → GameSpec)。サーバーが返す観測次元でアダプタとの整合を確認する
_REGISTRY: dict[str, Callable[[int], GameSpec]] = {
    "othello": _othello_from_obs_dim,
    "shogi": _shogi_from_obs_dim("shogi"),
    "shogi_3d": _shogi_from_obs_dim("shogi_3d"),
}


def get_game_spec(game_type: str, obs_dim: int) -> GameSpec:
    """game_type と実際の観測次元から GameSpec を作る。未登録ゲームは MLP 用の汎用 spec。"""
    key = game_type.lower().replace("-", "_")
    if key in _REGISTRY:
        return _REGISTRY[key](obs_dim)
    return GameSpec(
        game_type=key,
        obs_shape=None,
        n_actions=obs_dim,
        encode=lambda x: x.astype(np.float32),
        description=f"generic flat vector (dim={obs_dim})",
    )
