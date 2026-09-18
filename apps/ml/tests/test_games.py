"""GameSpec（観測 → NN 入力の整形）の単体テスト。サーバー不要。"""

from __future__ import annotations

import numpy as np
import pytest
import torch

from uge_rl.az_net import build_policy_value_net
from uge_rl.dqn import build_qnet
from uge_rl.games import SHOGI_N_ACTIONS, SHOGI_OBS_DIM, get_game_spec


def _shogi_initial_obs() -> np.ndarray:
    """ShogiTensorAdapter が初期局面で返す観測（先手視点）を再現する。"""
    board = np.zeros(81, dtype=np.float32)
    back = [2, 3, 4, 5, 8, 5, 4, 3, 2]
    board[0:9] = [-v for v in back]  # 後手の一段目
    board[9 + 1] = -7  # 後手の飛
    board[9 + 7] = -6  # 後手の角
    board[18:27] = -1  # 後手の歩
    board[54:63] = 1  # 先手の歩
    board[63 + 1] = 6  # 先手の角
    board[63 + 7] = 7  # 先手の飛
    board[72:81] = back  # 先手の九段目
    hands = np.zeros(14, dtype=np.float32)
    return np.concatenate([board, hands])


def test_shogi_spec_shape_and_actions() -> None:
    spec = get_game_spec("shogi", SHOGI_OBS_DIM)
    assert spec.obs_shape == (42, 9, 9)
    assert spec.n_actions == SHOGI_N_ACTIONS == 2187
    # shogi_3d も同じ契約
    assert get_game_spec("shogi_3d", SHOGI_OBS_DIM).n_actions == SHOGI_N_ACTIONS
    with pytest.raises(ValueError):
        get_game_spec("shogi", 81)


def test_shogi_planes_are_one_hot_per_piece_type() -> None:
    spec = get_game_spec("shogi", SHOGI_OBS_DIM)
    obs = _shogi_initial_obs()
    obs[81] = 3  # 自分の歩 3 枚
    obs[88 + 6] = 1  # 相手の飛 1 枚
    x = spec.encode(obs)
    assert x.shape == (42, 9, 9) and x.dtype == np.float32

    # 自分の玉（駒種 8 → チャンネル 7）は (4,8)、相手の玉（チャンネル 14+7）は (4,0)
    assert x[7, 8, 4] == 1 and x[7].sum() == 1
    assert x[14 + 7, 0, 4] == 1 and x[14 + 7].sum() == 1
    # 自分の歩（チャンネル 0）は 9 枚、相手の歩（チャンネル 14）も 9 枚
    assert x[0].sum() == 9 and x[14].sum() == 9
    # 盤面プレーンは各マス高々 1 つの駒種
    assert (x[:28].sum(axis=0) <= 1).all()
    # 持ち駒プレーンは枚数 / 上限を盤全体に敷く（歩 3/18、相手の飛 1/2）
    assert np.allclose(x[28], 3 / 18)
    assert np.allclose(x[28 + 7 + 6], 1 / 2)
    assert x[29:35].sum() == 0


def test_shogi_encode_handles_batches() -> None:
    spec = get_game_spec("shogi", SHOGI_OBS_DIM)
    batch = np.stack([_shogi_initial_obs()] * 3)
    x = spec.encode(batch)
    assert x.shape == (3, 42, 9, 9)
    assert np.array_equal(x[0], spec.encode(_shogi_initial_obs()))


def test_shogi_networks_forward() -> None:
    spec = get_game_spec("shogi", SHOGI_OBS_DIM)
    x = torch.as_tensor(spec.encode(np.stack([_shogi_initial_obs()] * 2)))
    net = build_policy_value_net(spec, SHOGI_OBS_DIM, channels=8, blocks=1)
    logits, values = net(x)
    assert logits.shape == (2, SHOGI_N_ACTIONS) and values.shape == (2,)
    q = build_qnet(spec, SHOGI_OBS_DIM)(x)
    assert q.shape == (2, SHOGI_N_ACTIONS)


def test_othello_spec_still_square() -> None:
    spec = get_game_spec("othello", 64)
    assert spec.obs_shape == (2, 8, 8) and spec.n_actions == 64
    with pytest.raises(ValueError):
        get_game_spec("othello", 65)
