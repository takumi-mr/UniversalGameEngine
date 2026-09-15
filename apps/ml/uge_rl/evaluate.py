"""学習済みエージェントをランダムプレイヤーと対戦させて勝率を測る。

    python -m uge_rl.evaluate --checkpoint models/othello_dqn.pt --games 100
"""

from __future__ import annotations

import argparse
import random
from dataclasses import dataclass

import numpy as np

from .checkpoint import load_checkpoint
from .dqn import DQNAgent
from .env import GrpcGameEnv


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


def play_vs_random(agent: DQNAgent, env: GrpcGameEnv, games: int = 50, epsilon: float = 0.0) -> EvalResult:
    """agent が先手・後手を交互に担当し、相手はランダムに指す。"""
    wins = losses = draws = 0
    for g in range(games):
        obs, legal, active = env.reset()
        agent_seat = env.player_ids[g % 2]
        done = False
        last_mover = None
        reward = 0.0
        while not done:
            mover = active[0]
            if mover == agent_seat:
                action = agent.act(obs, legal, epsilon=epsilon)
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
    args = p.parse_args()

    random.seed(args.seed)
    np.random.seed(args.seed)

    agent, meta = load_checkpoint(args.checkpoint)
    print(f"loaded {args.checkpoint}: game={meta['game_type']} steps={meta['total_steps']}")
    with GrpcGameEnv(args.address, game_type=meta["game_type"]) as env:
        result = play_vs_random(agent, env, games=args.games)
    print(result)


if __name__ == "__main__":
    main()
