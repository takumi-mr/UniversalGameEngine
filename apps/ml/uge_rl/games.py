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


# ---------------------------------------------------------------------- チェス
# ChessTensorAdapter（packages/shared/ai/TensorAdapter/ChessTensorAdapter.ts）の契約:
#   obs[0:64]  自分視点の盤面（黒は上下反転）。自分の駒 = +駒種 (1..6: P N B R Q K)、相手の駒 = -駒種、空 = 0
#   obs[64:68] キャスリング権（自分 K / 自分 Q / 相手 K / 相手 Q、0 or 1）
#   obs[68]    アンパッサンの対象マス（自分視点の index。なければ -1）
#   obs[69]    50 手ルールのカウンタ（半手数。100 で引き分け）
#   obs[70]    現局面の同形回数（1..3。3 で引き分け）
#   action = 移動先マス（自分視点）× 28 + 種別（0-7 移動方向 / 8-15 ナイト / 16-27 昇格）
CHESS_BOARD = 8
CHESS_SQUARES = CHESS_BOARD * CHESS_BOARD
CHESS_PIECE_TYPES = 6
CHESS_OBS_DIM = CHESS_SQUARES + 4 + 1 + 1 + 1  # 71
CHESS_ACTION_KINDS = 28
CHESS_N_ACTIONS = CHESS_SQUARES * CHESS_ACTION_KINDS  # 1792
CHESS_HALF_MOVES_MAX = 100.0
CHESS_REPETITION_MAX = 3.0
# 入力チャンネル: 自分の駒 6 + 相手の駒 6 + キャスリング権 4 + アンパッサン 1 + 50 手カウンタ 1 + 同形回数 1
CHESS_CHANNELS = CHESS_PIECE_TYPES * 2 + 4 + 1 + 1 + 1  # 19


def _chess_planes(obs: np.ndarray) -> np.ndarray:
    """71 要素の観測 → (19, 8, 8)。駒種ごとの one-hot プレーン + 盤全体に敷いたスカラー特徴 + アンパッサンの one-hot。"""
    if obs.shape[-1] != CHESS_OBS_DIM:
        raise ValueError(f"chess: expected obs_dim={CHESS_OBS_DIM}, got {obs.shape[-1]}")
    lead = obs.shape[:-1]
    board = obs[..., :CHESS_SQUARES].reshape(*lead, CHESS_BOARD, CHESS_BOARD)
    own = np.stack([board == t for t in range(1, CHESS_PIECE_TYPES + 1)], axis=-3)
    opp = np.stack([board == -t for t in range(1, CHESS_PIECE_TYPES + 1)], axis=-3)
    castling = obs[..., CHESS_SQUARES : CHESS_SQUARES + 4]
    scalars = np.concatenate(
        [
            castling,
            obs[..., CHESS_SQUARES + 5 : CHESS_SQUARES + 6] / CHESS_HALF_MOVES_MAX,
            obs[..., CHESS_SQUARES + 6 : CHESS_SQUARES + 7] / CHESS_REPETITION_MAX,
        ],
        axis=-1,
    )
    scalar_planes = np.broadcast_to(scalars[..., None, None], (*lead, 6, CHESS_BOARD, CHESS_BOARD))
    ep = obs[..., CHESS_SQUARES + 4].astype(np.int64)
    squares = np.arange(CHESS_SQUARES).reshape(CHESS_BOARD, CHESS_BOARD)
    ep_plane = (squares == ep[..., None, None])[..., None, :, :]
    return np.concatenate([own, opp, scalar_planes, ep_plane], axis=-3).astype(np.float32)


def make_chess_spec(game_type: str = "chess") -> GameSpec:
    return GameSpec(
        game_type=game_type,
        obs_shape=(CHESS_CHANNELS, CHESS_BOARD, CHESS_BOARD),
        n_actions=CHESS_N_ACTIONS,
        encode=_chess_planes,
        description=(
            "Chess 8x8: obs=自分視点の盤面 64 + キャスリング権 4 + アンパッサン 1 + 50 手カウンタ 1 + 同形回数 1, "
            f"action=移動先 x {CHESS_ACTION_KINDS} + 種別 ({CHESS_N_ACTIONS} 通り)"
        ),
    )


def _chess_from_obs_dim(game_type: str) -> Callable[[int], GameSpec]:
    def build(obs_dim: int) -> GameSpec:
        if obs_dim != CHESS_OBS_DIM:
            raise ValueError(f"{game_type}: expected obs_dim={CHESS_OBS_DIM}, got {obs_dim}")
        return make_chess_spec(game_type)

    return build


# ---------------------------------------------------------------------- 囲碁
# GoTensorAdapter（packages/shared/ai/TensorAdapter/GoTensorAdapter.ts）の契約（N = size × size。size は観測次元から求める）:
#   obs[0:N]    現在の盤面。自分の石 = +1、相手の石 = -1、空 = 0（白番のプレイヤーから見ると符号反転。回転はしない）
#   obs[N:2N]   直前に石が置かれる前の盤面（同じ符号規約。開始直後は全 0）。コウの禁止点や最後の着手位置が分かる
#   obs[2N]     連続パス数（0 or 1。1 なら自分がパスすると終局）
#   obs[2N+1]   自分視点のコミ（黒なら -komi、白なら +komi。自分の色も兼ねる）
#   action = 打つ点の index（0..N-1）、N = パス
GO_KOMI_SCALE = 10.0
# 入力チャンネル: 自分の石 / 相手の石 / 直前の自分の石 / 直前の相手の石 / 連続パス数 / コミ / 定数 1（盤端の検出用）
GO_CHANNELS = 7


def go_board_size(obs_dim: int) -> int:
    """観測次元から盤のサイズを求める（2 × size² + 2）。"""
    n = (obs_dim - 2) // 2
    size = int(math.isqrt(max(n, 0)))
    if obs_dim < 2 or (obs_dim - 2) % 2 != 0 or size * size != n:
        raise ValueError(f"go: obs_dim={obs_dim} is not 2 * size^2 + 2")
    return size


def go_obs_dim(size: int) -> int:
    return size * size * 2 + 2


def go_n_actions(size: int) -> int:
    return size * size + 1


def _go_planes(size: int) -> Callable[[np.ndarray], np.ndarray]:
    n = size * size

    def encode(obs: np.ndarray) -> np.ndarray:
        """2N + 2 要素の観測 → (7, size, size)。"""
        if obs.shape[-1] != go_obs_dim(size):
            raise ValueError(f"go: expected obs_dim={go_obs_dim(size)}, got {obs.shape[-1]}")
        lead = obs.shape[:-1]
        board = obs[..., :n].reshape(*lead, size, size)
        prev = obs[..., n : 2 * n].reshape(*lead, size, size)
        stones = np.stack([board == 1, board == -1, prev == 1, prev == -1], axis=-3)
        scalars = np.stack([obs[..., 2 * n], obs[..., 2 * n + 1] / GO_KOMI_SCALE, np.ones(lead)], axis=-1)
        scalar_planes = np.broadcast_to(scalars[..., None, None], (*lead, 3, size, size))
        return np.concatenate([stones, scalar_planes], axis=-3).astype(np.float32)

    return encode


def make_go_spec(size: int = 9) -> GameSpec:
    return GameSpec(
        game_type="go",
        obs_shape=(GO_CHANNELS, size, size),
        n_actions=go_n_actions(size),
        encode=_go_planes(size),
        description=(
            f"Go {size}x{size}: obs=自分=+1/相手=-1 の盤面 + 直前の盤面 + パス数 + コミ, "
            f"action=打つ点の index / {size * size}=パス ({go_n_actions(size)} 通り)"
        ),
    )


def _go_from_obs_dim(obs_dim: int) -> GameSpec:
    return make_go_spec(go_board_size(obs_dim))


# ---------------------------------------------------------------------- レジストリ
# game_type → (obs_dim → GameSpec)。サーバーが返す観測次元でアダプタとの整合を確認する
_REGISTRY: dict[str, Callable[[int], GameSpec]] = {
    "othello": _othello_from_obs_dim,
    "shogi": _shogi_from_obs_dim("shogi"),
    "shogi_3d": _shogi_from_obs_dim("shogi_3d"),
    "chess": _chess_from_obs_dim("chess"),
    "chess_3d": _chess_from_obs_dim("chess_3d"),
    "go": _go_from_obs_dim,
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
