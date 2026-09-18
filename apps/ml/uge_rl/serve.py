"""学習済みモデルを、実際の対局の「gRPC External (grpc_bot)」席の指し手として動かす。

    # バックエンドを起動しておく（探索付きの AlphaZero を使うなら task rl = RL_MODE=true）
    python -m uge_rl.serve --checkpoint ../../models/shogi_az.pt

フロントエンドで「☁️ gRPC External」を選んで部屋を作ると、バックエンドは grpc_bot 種別のボットを着席させ、
手番が来るたびに gRPC WaitForTurn ストリームへ観測・合法手・局面 (state_json) を流す。このスクリプトは

  1. HTTP `GET /rooms/<game_type>` を定期的に見て、grpc_bot が着席している部屋を見つける
  2. 部屋（ボット）ごとにスレッドで WaitForTurn を張り、手番が来たらモデルで手を選んで SubmitTurn する

AlphaZero 風モデルの木探索は gRPC Simulate を使うため、バックエンドが RL_MODE=true のときだけ有効。
通常モードのバックエンドに繋ぐと Simulate は PERMISSION_DENIED になるので、その場合は自動的に
policy head の argmax（探索なし）へ切り替える。最初から探索なしにするなら --simulations 0。
"""

from __future__ import annotations

import argparse
import json
import sys
import threading
import time
import urllib.error
import urllib.request

import grpc
import numpy as np

from proto import game_pb2

from .az_agent import AZAgent
from .checkpoint import Agent, load_checkpoint
from .env import GrpcGameEnv

BOT_AI_TYPE = "grpc_bot"


def log(msg: str) -> None:
    print(f"[serve {time.strftime('%H:%M:%S')}] {msg}", flush=True)


def normalize_game_type(t: str) -> str:
    return t.lower().replace("-", "_")


class ModelBotServer:
    """1 つのチェックポイントで、同じゲーム種別のすべての grpc_bot 席を担当する。"""

    def __init__(
        self,
        agent: Agent,
        meta: dict,
        grpc_address: str,
        http_base: str,
        simulations: int | None,
        poll_interval: float,
        game_id: str | None = None,
    ) -> None:
        self.agent = agent
        self.game_type = normalize_game_type(meta["game_type"])
        self.grpc_address = grpc_address
        self.http_base = http_base.rstrip("/")
        self.poll_interval = poll_interval
        self.only_game_id = game_id
        # 探索回数。None ならチェックポイントの eval_simulations。DQN では使わない
        if isinstance(agent, AZAgent):
            self.simulations = agent.cfg.eval_simulations if simulations is None else int(simulations)
        else:
            self.simulations = 0
        # 推論・探索はスレッドをまたいで直列化する（複数の部屋で同時に手番が来ても 1 局ずつ考える）
        self._think_lock = threading.Lock()
        self._lock = threading.Lock()
        # (game_id, player_id) → WaitForTurn の call（部屋が消えたら cancel する）。接続中は None
        self._streams: dict[tuple[str, str], grpc.Call | None] = {}

    # ------------------------------------------------------------------ 指し手
    def choose(self, obs: np.ndarray, legal: np.ndarray, state_json: str, player_id: str, env: GrpcGameEnv) -> int:
        with self._think_lock:
            if isinstance(self.agent, AZAgent):
                if self.simulations > 0 and state_json:
                    self.agent.cfg.eval_simulations = self.simulations
                    try:
                        return self.agent.select_action(obs, legal, state_json, player_id, env)
                    except grpc.RpcError as err:
                        if err.code() != grpc.StatusCode.PERMISSION_DENIED:
                            raise
                        log(
                            "Simulate is not available (backend is not in RL_MODE); "
                            "falling back to policy-only moves (--simulations 0)"
                        )
                        self.simulations = 0
                return self.agent.raw_policy_action(obs, legal)
            return self.agent.select_action(obs, legal, state_json, player_id, env)

    # ------------------------------------------------------------------ 部屋の発見
    def discover(self) -> list[tuple[str, str]]:
        """grpc_bot が着席している (game_id, player_id) の一覧を HTTP から取る。"""
        url = f"{self.http_base}/rooms/{self.game_type}"
        try:
            with urllib.request.urlopen(url, timeout=5) as res:
                rooms = json.load(res).get("rooms", [])
        except (urllib.error.URLError, TimeoutError, ValueError) as err:
            log(f"failed to list rooms ({url}): {err}")
            return []
        seats: list[tuple[str, str]] = []
        for room in rooms:
            if self.only_game_id and room.get("id") != self.only_game_id:
                continue
            for bot in room.get("bots") or []:
                if bot.get("aiType") == BOT_AI_TYPE and bot.get("playerId"):
                    seats.append((room["id"], bot["playerId"]))
        return seats

    # ------------------------------------------------------------------ 1 席分のループ
    def serve_seat(self, game_id: str, player_id: str) -> None:
        # 探索（simulate_batch）は再接続を伴うことがあるので、席ごとに独立した接続を使う
        env = GrpcGameEnv(self.grpc_address, game_type=self.game_type).connect()
        call = env.stub.WaitForTurn(game_pb2.WaitForTurnRequest(game_id=game_id, player_id=player_id))
        with self._lock:
            self._streams[(game_id, player_id)] = call
        log(f"serving {player_id} in room {game_id}")
        try:
            for turn in call:
                legal = np.asarray(turn.legal_action_ids, dtype=np.int64)
                if legal.size == 0:
                    continue
                obs = np.asarray(turn.state_tensor, dtype=np.float32)
                t0 = time.time()
                action = self.choose(obs, legal, turn.state_json, player_id, env)
                res = env.stub.SubmitTurn(
                    game_pb2.SubmitTurnRequest(game_id=game_id, player_id=player_id, action_id=int(action)),
                    timeout=env.rpc_timeout,
                )
                log(
                    f"{game_id}/{player_id}: action={action} legal={legal.size} "
                    f"sims={self.simulations} {time.time() - t0:.1f}s -> {res.message}"
                )
        except grpc.RpcError as err:
            if err.code() != grpc.StatusCode.CANCELLED:
                log(f"{game_id}/{player_id}: stream ended ({err.code().name}: {err.details()})")
        except Exception as err:  # noqa: BLE001
            log(f"{game_id}/{player_id}: error: {err!r}")
        finally:
            with self._lock:
                self._streams.pop((game_id, player_id), None)
            env.close()
            log(f"stopped serving {player_id} in room {game_id}")

    # ------------------------------------------------------------------ メインループ
    def run(self) -> None:
        log(
            f"game={self.game_type} agent={type(self.agent).__name__} sims={self.simulations} "
            f"grpc={self.grpc_address} http={self.http_base}"
        )
        log("waiting for rooms with a gRPC External seat...")
        while True:
            seats = set(self.discover())
            with self._lock:
                serving = set(self._streams)
            for game_id, player_id in seats - serving:
                with self._lock:
                    self._streams[(game_id, player_id)] = None  # 次のポーリングで二重起動しないよう先に予約
                threading.Thread(target=self.serve_seat, args=(game_id, player_id), daemon=True).start()
            # 部屋が消えたらストリームを閉じる（サーバーは空室を 5 分で掃除する）
            for key in serving - seats:
                with self._lock:
                    call = self._streams.get(key)
                if call is not None:
                    call.cancel()
            time.sleep(self.poll_interval)


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--checkpoint", required=True)
    p.add_argument("--address", default="localhost:50051", help="バックエンドの gRPC アドレス")
    p.add_argument("--http", default="http://localhost:3000", help="バックエンドの HTTP アドレス（部屋一覧の取得用）")
    p.add_argument("--simulations", type=int, default=None, help="AlphaZero の探索回数（省略時はチェックポイントの設定、0 = 探索なし）")
    p.add_argument("--poll", type=float, default=2.0, help="部屋一覧を見に行く間隔（秒）")
    p.add_argument("--game-id", default=None, help="この部屋だけを担当する（省略時は同じゲーム種別の全部屋）")
    p.add_argument("--device", default=None)
    args = p.parse_args()

    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")

    agent, meta = load_checkpoint(args.checkpoint, device=args.device)
    log(f"loaded {args.checkpoint}: format={meta['format']} game={meta['game_type']}")
    server = ModelBotServer(
        agent,
        meta,
        grpc_address=args.address,
        http_base=args.http,
        simulations=args.simulations,
        poll_interval=args.poll,
        game_id=args.game_id,
    )
    try:
        server.run()
    except KeyboardInterrupt:
        log("bye")


if __name__ == "__main__":
    main()
