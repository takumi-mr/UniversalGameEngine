"""学習済みエージェントをランダムプレイヤーと対戦させて勝率を測る。

    python -m uge_rl.evaluate --checkpoint models/othello_dqn.pt --games 100
"""

from __future__ import annotations

import argparse
import random
from dataclasses import dataclass

import numpy as np

from typing import Protocol

from .checkpoint import load_checkpoint
from .env import GrpcGameEnv


class Policy(Protocol):
    """対局に使える指し手の共通インターフェース（DQNAgent / AZAgent が満たす）。"""

    def select_action(
        self, obs: np.ndarray, legal: np.ndarray, state_json: str, player_id: str, env: GrpcGameEnv
    ) -> int: ...


@dataclass
class EvalResult:
    games: int
    wins: int
    losses: int
    draws: int

    @property
    def win_rate(self) -> float:
        return self.wins / max(1, self.games)

    def __str__(self) -> str:
        return (
            f"games={self.games} win={self.wins} loss={self.losses} draw={self.draws} "
            f"win_rate={self.win_rate:.3f}"
        )


def play_vs_random(agent: Policy, env: GrpcGameEnv, games: int = 50, max_moves: int = 0) -> EvalResult:
    """agent が先手・後手を交互に担当し、相手はランダムに指す。max_moves を超えた対局は引き分け（0 = 無制限）。"""
    wins = losses = draws = 0
    for g in range(games):
        obs, legal, active = env.reset()
        agent_seat = env.player_ids[g % 2]
        done = False
        last_mover = None
        reward = 0.0
        moves = 0
        while not done:
            if max_moves and moves >= max_moves:
                reward = 0.0
                break
            moves += 1
            mover = active[0]
            if mover == agent_seat:
                action = agent.select_action(obs, legal, env.state_json, mover, env)
            else:
                action = int(random.choice(legal.tolist()))
            res = env.step(mover, action)
            obs, legal, active, done = res.obs, res.legal_actions, res.active_players, res.done
            last_mover, reward = mover, res.reward

        outcome = reward if last_mover == agent_seat else -reward
        if outcome > 0:
            wins += 1
        elif outcome < 0:
            losses += 1
        else:
            draws += 1
    return EvalResult(games, wins, losses, draws)


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--checkpoint", required=True)
    p.add_argument("--address", default="localhost:50051")
    p.add_argument("--games", type=int, default=100)
    p.add_argument("--seed", type=int, default=0)
    p.add_argument("--max-moves", type=int, default=None, help="手数上限（省略時はチェックポイントの設定、0 = 無制限）")
    args = p.parse_args()

    random.seed(args.seed)
    np.random.seed(args.seed)

    agent, meta = load_checkpoint(args.checkpoint)
    print(f"loaded {args.checkpoint}: format={meta['format']} game={meta['game_type']}")
    max_moves = args.max_moves if args.max_moves is not None else int(meta.get("config", {}).get("max_moves", 0) or 0)
    with GrpcGameEnv(args.address, game_type=meta["game_type"]) as env:
        result = play_vs_random(agent, env, games=args.games, max_moves=max_moves)
    print(result)


if __name__ == "__main__":
    main()
