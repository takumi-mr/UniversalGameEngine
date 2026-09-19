"""GameSpec（観測 → NN 入力の整形）の単体テスト。サーバー不要。"""

from __future__ import annotations

import numpy as np
import pytest
import torch

from uge_rl.az_net import build_policy_value_net
from uge_rl.dqn import build_qnet
from uge_rl.games import CHESS_N_ACTIONS, CHESS_OBS_DIM, SHOGI_N_ACTIONS, SHOGI_OBS_DIM, get_game_spec


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


def _chess_initial_obs() -> np.ndarray:
    """ChessTensorAdapter が初期局面で返す観測（白視点）を再現する。"""
    board = np.zeros(64, dtype=np.float32)
    back = [4, 2, 3, 5, 6, 3, 2, 4]
    board[0:8] = [-v for v in back]  # 黒の一段目
    board[8:16] = -1  # 黒のポーン
    board[48:56] = 1  # 白のポーン
    board[56:64] = back  # 白の一段目
    # キャスリング権 4 つ、アンパッサンなし、50 手カウンタ 0、同形 1 回目
    extra = np.array([1, 1, 1, 1, -1, 0, 1], dtype=np.float32)
    return np.concatenate([board, extra])


def test_chess_spec_shape_and_actions() -> None:
    spec = get_game_spec("chess", CHESS_OBS_DIM)
    assert spec.obs_shape == (19, 8, 8)
    assert spec.n_actions == CHESS_N_ACTIONS == 1792
    # chess_3d も同じ契約
    assert get_game_spec("chess_3d", CHESS_OBS_DIM).n_actions == CHESS_N_ACTIONS
    with pytest.raises(ValueError):
        get_game_spec("chess", 64)


def test_chess_planes_encode_pieces_and_scalars() -> None:
    spec = get_game_spec("chess", CHESS_OBS_DIM)
    obs = _chess_initial_obs()
    obs[64 + 1] = 0  # 自分のクイーンサイドのキャスリング権を失った
    obs[68] = 3 * 8 + 4  # アンパッサンの対象 (x=4, y=3)
    obs[69] = 50  # 50 手カウンタ
    obs[70] = 2  # 同形 2 回目
    x = spec.encode(obs)
    assert x.shape == (19, 8, 8) and x.dtype == np.float32

    # 自分のキング（駒種 6 → チャンネル 5）は (4,7)、相手のキング（チャンネル 6+5）は (4,0)
    assert x[5, 7, 4] == 1 and x[5].sum() == 1
    assert x[6 + 5, 0, 4] == 1 and x[6 + 5].sum() == 1
    # 自分のポーン（チャンネル 0）は 8 枚、相手のポーン（チャンネル 6）も 8 枚
    assert x[0].sum() == 8 and x[6].sum() == 8
    # 盤面プレーンは各マス高々 1 つの駒種
    assert (x[:12].sum(axis=0) <= 1).all()
    # キャスリング権は盤全体に敷く（自分 K=1, 自分 Q=0, 相手 K=1, 相手 Q=1）
    assert np.allclose(x[12], 1) and np.allclose(x[13], 0) and np.allclose(x[14], 1) and np.allclose(x[15], 1)
    # 50 手カウンタ / 100、同形回数 / 3
    assert np.allclose(x[16], 0.5)
    assert np.allclose(x[17], 2 / 3)
    # アンパッサンは one-hot
    assert x[18, 3, 4] == 1 and x[18].sum() == 1


def test_chess_en_passant_plane_is_empty_without_target() -> None:
    spec = get_game_spec("chess", CHESS_OBS_DIM)
    x = spec.encode(_chess_initial_obs())
    assert x[18].sum() == 0
    assert np.allclose(x[17], 1 / 3)


def test_chess_encode_handles_batches() -> None:
    spec = get_game_spec("chess", CHESS_OBS_DIM)
    second = _chess_initial_obs()
    second[68] = 20
    batch = np.stack([_chess_initial_obs(), second, _chess_initial_obs()])
    x = spec.encode(batch)
    assert x.shape == (3, 19, 8, 8)
    assert np.array_equal(x[0], spec.encode(_chess_initial_obs()))
    assert np.array_equal(x[1], spec.encode(second))
    assert x[1, 18, 2, 4] == 1 and x[0, 18].sum() == 0


def test_chess_networks_forward() -> None:
    spec = get_game_spec("chess", CHESS_OBS_DIM)
    x = torch.as_tensor(spec.encode(np.stack([_chess_initial_obs()] * 2)))
    net = build_policy_value_net(spec, CHESS_OBS_DIM, channels=8, blocks=1)
    logits, values = net(x)
    assert logits.shape == (2, CHESS_N_ACTIONS) and values.shape == (2,)
    q = build_qnet(spec, CHESS_OBS_DIM)(x)
    assert q.shape == (2, CHESS_N_ACTIONS)


def test_othello_spec_still_square() -> None:
    spec = get_game_spec("othello", 64)
    assert spec.obs_shape == (2, 8, 8) and spec.n_actions == 64
    with pytest.raises(ValueError):
        get_game_spec("othello", 65)
