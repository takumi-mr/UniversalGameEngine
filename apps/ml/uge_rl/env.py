"""gRPC 経由でゲームエンジンを操作する Gym 風の環境ラッパー。

サーバー側 (apps/backend/grpc-server.ts) の契約:
  - Reset: 全席に player_ids を着席させ PLAYING にし、active_players[0] 視点の観測を返す
  - Step : player_id が action_id を指す。戻り値の観測・合法手は「次に行動するプレイヤー」視点、
           reward は手を指した player_id 視点（終局時のみ非ゼロ。勝=1, 負=-1, 引分=0.5）
  - Simulate / BatchSimulate: セッションに触れず、渡した state_json に 1 手適用した結果を返す（木探索用）
"""

from __future__ import annotations

import sys
import time
from dataclasses import dataclass, field
from typing import Sequence

import grpc
import numpy as np

from proto import game_pb2, game_pb2_grpc


@dataclass
class StepResult:
    obs: np.ndarray  # 次の手番プレイヤー視点の状態テンソル (float32, 1 次元)
    legal_actions: np.ndarray  # 次の手番プレイヤーの合法手 ID (int64)
    reward: float  # 手を指したプレイヤー視点の報酬
    done: bool
    active_players: list[str] = field(default_factory=list)
    # 局面の完全な状態（サーバーが返す JSON 文字列）。Simulate の親局面としてそのまま渡す。中身は解釈しない
    state_json: str = ""
    # Simulate 専用: 空文字なら成功。不正な手などの場合にメッセージが入る
    error: str = ""

    @property
    def next_player(self) -> str | None:
        return self.active_players[0] if self.active_players else None

    @property
    def ok(self) -> bool:
        return self.error == ""


class GrpcGameEnv:
    """1 セッションのゲームを CreateGame → Reset → Step... で回す環境。

    自己対戦を前提に、1 つのインスタンスで全プレイヤーの手番を進める。
    """

    def __init__(
        self,
        address: str = "localhost:50051",
        game_type: str = "othello",
        options: dict | None = None,
        player_ids: Sequence[str] = ("player_1", "player_2"),
        draw_reward: float = 0.0,
        rpc_timeout: float = 10.0,
        max_retries: int = 3,
    ) -> None:
        self.address = address
        self.game_type = game_type
        self.options = options or {}
        self.player_ids = list(player_ids)
        self.draw_reward = draw_reward
        self.rpc_timeout = rpc_timeout
        self.max_retries = max_retries

        self._channel: grpc.Channel | None = None
        self._stub: game_pb2_grpc.GameServiceStub | None = None
        self.game_id: str | None = None
        self.n_actions: int | None = None
        self.obs_dim: int | None = None
        # 直近の reset / step が返した局面（Simulate のルートに使う）
        self.state_json: str = ""

    # ------------------------------------------------------------------ 接続
    def connect(self, wait_ready_sec: float = 30.0) -> "GrpcGameEnv":
        self._channel = grpc.insecure_channel(self.address)
        grpc.channel_ready_future(self._channel).result(timeout=wait_ready_sec)
        self._stub = game_pb2_grpc.GameServiceStub(self._channel)
        return self

    def close(self) -> None:
        if self._channel is not None:
            self._channel.close()
            self._channel = None
            self._stub = None

    def __enter__(self) -> "GrpcGameEnv":
        return self.connect()

    def __exit__(self, *_exc) -> None:
        self.close()

    @property
    def stub(self) -> game_pb2_grpc.GameServiceStub:
        if self._stub is None:
            self.connect()
        assert self._stub is not None
        return self._stub

    # 長時間の連続通信で HTTP/2 トランスポートが壊れることがある
    # （grpc-python ⇔ Bun の http2 で "Stream removed (Too many zero length data frames)" 等）。
    # 冪等な RPC（Reset / Simulate / BatchSimulate）はチャネルを張り直して再試行する。
    _RETRYABLE = (grpc.StatusCode.UNAVAILABLE, grpc.StatusCode.UNKNOWN, grpc.StatusCode.INTERNAL)

    def _call_idempotent(self, method: str, request):
        last: grpc.RpcError | None = None
        for attempt in range(self.max_retries + 1):
            try:
                return getattr(self.stub, method)(request, timeout=self.rpc_timeout)
            except grpc.RpcError as err:
                if err.code() not in self._RETRYABLE or attempt == self.max_retries:
                    raise
                last = err
                print(
                    f"[GrpcGameEnv] {method} failed ({err.code().name}); reconnecting and retrying "
                    f"({attempt + 1}/{self.max_retries})",
                    file=sys.stderr,
                    flush=True,
                )
                time.sleep(0.2 * (attempt + 1))
                self.close()
                self.connect()
        assert last is not None
        raise last

    # ------------------------------------------------------------------ RPC
    def create_game(self) -> str:
        import json

        res = self.stub.CreateGame(
            game_pb2.CreateGameRequest(game_type=self.game_type, options_json=json.dumps(self.options)),
            timeout=self.rpc_timeout,
        )
        self.game_id = res.game_id
        return self.game_id

    def reset(self) -> tuple[np.ndarray, np.ndarray, list[str]]:
        """(obs, legal_actions, active_players) を返す。"""
        if self.game_id is None:
            self.create_game()
        try:
            res = self._reset_rpc()
        except grpc.RpcError as err:
            # サーバー側の空室掃除（5 分）でセッションが消えていたら作り直す
            if err.code() == grpc.StatusCode.NOT_FOUND:
                self.create_game()
                res = self._reset_rpc()
            else:
                raise

        obs = np.asarray(res.initial_state_tensor, dtype=np.float32)
        legal = np.asarray(res.initial_legal_action_ids, dtype=np.int64)
        self.state_json = res.state_json
        self.obs_dim = obs.shape[0]
        if self.n_actions is None:
            # 行動空間の大きさはアダプタの定義次第。盤面ゲームでは obs_dim == n_actions が基本
            self.n_actions = self.obs_dim
        return obs, legal, list(res.active_players)

    def _reset_rpc(self):
        assert self.game_id is not None
        return self._call_idempotent(
            "Reset", game_pb2.ResetGameRequest(game_id=self.game_id, player_ids=self.player_ids)
        )

    def step(self, player_id: str, action_id: int) -> StepResult:
        assert self.game_id is not None, "call reset() first"
        res = self.stub.Step(
            game_pb2.StepRequest(game_id=self.game_id, player_id=player_id, action_id=int(action_id)),
            timeout=self.rpc_timeout,
        )
        self.state_json = res.state_json
        return StepResult(
            obs=np.asarray(res.next_state_tensor, dtype=np.float32),
            legal_actions=np.asarray(res.legal_action_ids, dtype=np.int64),
            reward=self._normalize_reward(res.reward, res.is_finished),
            done=bool(res.is_finished),
            active_players=list(res.active_players),
            state_json=res.state_json,
        )

    def _normalize_reward(self, reward: float, is_finished: bool) -> float:
        # エンジンは引き分けを 0.5 で返すが、ゼロサム学習では 0 の方が扱いやすい
        reward = float(reward)
        if is_finished and abs(reward - 0.5) < 1e-6:
            return self.draw_reward
        return reward

    # ------------------------------------------------------------------ 木探索用（セッション非依存）
    def _simulate_request(self, state_json: str, player_id: str, action_id: int):
        return game_pb2.SimulateRequest(
            game_type=self.game_type,
            state_json=state_json,
            player_id=player_id,
            action_id=int(action_id),
        )

    def _to_sim_result(self, res) -> StepResult:
        return StepResult(
            obs=np.asarray(res.state_tensor, dtype=np.float32),
            legal_actions=np.asarray(res.legal_action_ids, dtype=np.int64),
            reward=self._normalize_reward(res.reward, res.is_finished),
            done=bool(res.is_finished),
            active_players=list(res.active_players),
            state_json=res.state_json,
            error=res.error,
        )

    def simulate(self, state_json: str, player_id: str, action_id: int) -> StepResult:
        """任意の局面に 1 手適用した結果を返す。セッションの実局面は変化しない。

        失敗（不正な手など）は例外ではなく result.error に入る。
        """
        res = self._call_idempotent("Simulate", self._simulate_request(state_json, player_id, action_id))
        return self._to_sim_result(res)

    def simulate_batch(self, items: Sequence[tuple[str, str, int]]) -> list[StepResult]:
        """(state_json, player_id, action_id) のリストをまとめて適用する。結果は入力と同じ順序。"""
        if not items:
            return []
        req = game_pb2.BatchSimulateRequest(
            items=[self._simulate_request(s, p, a) for s, p, a in items]
        )
        res = self._call_idempotent("BatchSimulate", req)
        return [self._to_sim_result(r) for r in res.items]


def wait_for_server(address: str, timeout_sec: float = 60.0, interval: float = 1.0) -> None:
    """バックエンド起動待ち（Colab などでサーバーをバックグラウンド起動した直後に使う）。"""
    deadline = time.time() + timeout_sec
    last_err: Exception | None = None
    while time.time() < deadline:
        try:
            ch = grpc.insecure_channel(address)
            grpc.channel_ready_future(ch).result(timeout=interval)
            ch.close()
            return
        except Exception as err:  # noqa: BLE001
            last_err = err
            time.sleep(interval)
    raise TimeoutError(f"gRPC server at {address} not ready: {last_err}")
