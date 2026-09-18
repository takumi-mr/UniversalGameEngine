"""自己対戦 DQN の学習ループ。

    # 事前に RL_MODE=true でバックエンドを起動しておく（task rl）
    python -m uge_rl.train --game othello --episodes 2000 --out models/othello_dqn.pt

学習の流れ:
  Reset → 手番プレイヤーの観測で行動を選ぶ → Step → 遷移をバッファに積む → 勾配更新 → ... → 終局
終局時は「最後に指した側」の報酬 r と、「その相手」の最後の遷移に -r を書き戻す。
"""

from __future__ import annotations

import argparse
import random
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import torch

from .checkpoint import load_checkpoint, save_checkpoint
from .dqn import DQNAgent, DQNConfig
from .env import GrpcGameEnv
from .evaluate import play_vs_random
from .games import get_game_spec


@dataclass
class TrainStats:
    episodes: int = 0
    steps: int = 0
    losses: list[float] = field(default_factory=list)
    eval_history: list[tuple[int, float]] = field(default_factory=list)  # (episode, win_rate)


def run_episode(agent: DQNAgent, env: GrpcGameEnv, train: bool = True) -> tuple[int, float]:
    """1 エピソード自己対戦する。(手数, 最後の遷移の loss 平均) を返す。

    cfg.max_moves を超えたら引き分けとして打ち切り、両者の最後の遷移を報酬 0 の終端にする。
    """
    obs, legal, active = env.reset()
    last_index: dict[str, int] = {}  # プレイヤーごとの「最後に積んだ遷移」の index
    losses: list[float] = []
    steps = 0
    done = False

    while not done:
        mover = active[0]
        action = agent.act(obs, legal) if train else agent.greedy(obs, legal)
        res = env.step(mover, action)
        steps += 1
        agent.total_steps += 1

        next_mover = res.next_player
        sign = 1.0 if next_mover == mover else -1.0

        if train:
            idx = agent.buffer.add(obs, action, res.reward, res.obs, res.legal_actions, res.done, sign)
            last_index[mover] = idx
            if res.done:
                # 相手側の最後の遷移も終端にして、逆符号の報酬を与える
                for pid, pidx in last_index.items():
                    if pid != mover:
                        agent.buffer.set_terminal(pidx, -res.reward)
            if agent.total_steps % agent.cfg.train_every == 0:
                loss = agent.train_step()
                if loss is not None:
                    losses.append(loss)

        obs, legal, active, done = res.obs, res.legal_actions, res.active_players, res.done

        if not done and agent.cfg.max_moves and steps >= agent.cfg.max_moves:
            if train:
                for pidx in last_index.values():
                    agent.buffer.set_terminal(pidx, 0.0)
            break

    return steps, float(np.mean(losses)) if losses else float("nan")


def train(
    env: GrpcGameEnv,
    agent: DQNAgent,
    episodes: int,
    out: Path,
    eval_every: int = 200,
    eval_games: int = 20,
    save_every: int = 500,
    log_every: int = 50,
) -> TrainStats:
    stats = TrainStats()
    t0 = time.time()
    recent_lengths: list[int] = []

    for ep in range(1, episodes + 1):
        steps, loss = run_episode(agent, env, train=True)
        stats.episodes = ep
        stats.steps += steps
        recent_lengths.append(steps)
        if not np.isnan(loss):
            stats.losses.append(loss)

        if ep % log_every == 0:
            elapsed = time.time() - t0
            avg_loss = np.mean(stats.losses[-log_every:]) if stats.losses else float("nan")
            print(
                f"[ep {ep:>6}] steps={stats.steps} eps={agent.epsilon:.3f} "
                f"loss={avg_loss:.4f} len={np.mean(recent_lengths[-log_every:]):.1f} "
                f"buffer={agent.buffer.size} {stats.steps / max(1, elapsed):.0f} steps/s",
                flush=True,
            )

        if eval_every and ep % eval_every == 0:
            result = play_vs_random(agent, env, games=eval_games, max_moves=agent.cfg.max_moves)
            stats.eval_history.append((ep, result.win_rate))
            print(f"[eval ep {ep}] vs random: {result}", flush=True)

        if save_every and ep % save_every == 0:
            save_checkpoint(agent, out, extra={"episodes": ep})
            print(f"[save] {out}", flush=True)

    save_checkpoint(agent, out, extra={"episodes": stats.episodes, "eval_history": stats.eval_history})
    print(f"[save] final model -> {out}", flush=True)
    return stats


def build_agent(env: GrpcGameEnv, cfg: DQNConfig, device: str | None, resume: str | None) -> DQNAgent:
    if resume:
        agent, meta = load_checkpoint(resume, device=device)
        if not isinstance(agent, DQNAgent):
            raise SystemExit(f"{resume} is not a DQN checkpoint (format={meta['format']})")
        print(f"resumed from {resume} (steps={meta['total_steps']})")
        return agent
    obs, _, _ = env.reset()
    spec = get_game_spec(env.game_type, obs.shape[0])
    print(f"game spec: {spec.description}")
    return DQNAgent(spec, obs.shape[0], cfg, device=device)


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--game", default="othello")
    p.add_argument("--address", default="localhost:50051")
    p.add_argument("--episodes", type=int, default=2000)
    p.add_argument("--out", default="models/othello_dqn.pt")
    p.add_argument("--resume", default=None, help="既存チェックポイントから学習を再開")
    p.add_argument("--device", default=None, help="cuda / cpu（省略時は自動）")
    p.add_argument("--seed", type=int, default=0)
    p.add_argument("--eval-every", type=int, default=200)
    p.add_argument("--eval-games", type=int, default=20)
    p.add_argument("--save-every", type=int, default=500)
    p.add_argument("--log-every", type=int, default=50)
    # DQN ハイパーパラメータ
    p.add_argument("--gamma", type=float, default=DQNConfig.gamma)
    p.add_argument("--lr", type=float, default=DQNConfig.lr)
    p.add_argument("--batch-size", type=int, default=DQNConfig.batch_size)
    p.add_argument("--buffer-size", type=int, default=DQNConfig.buffer_size)
    p.add_argument("--warmup-steps", type=int, default=DQNConfig.warmup_steps)
    p.add_argument("--target-sync-every", type=int, default=DQNConfig.target_sync_every)
    p.add_argument("--eps-end", type=float, default=DQNConfig.eps_end)
    p.add_argument("--eps-decay-steps", type=int, default=DQNConfig.eps_decay_steps)
    p.add_argument("--train-every", type=int, default=DQNConfig.train_every)
    p.add_argument("--max-moves", type=int, default=DQNConfig.max_moves, help="1 エピソードの手数上限（0 = 無制限）")
    args = p.parse_args()

    # Windows コンソール等で日本語ログが化けないようにする
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")

    random.seed(args.seed)
    np.random.seed(args.seed)
    torch.manual_seed(args.seed)

    cfg = DQNConfig(
        gamma=args.gamma,
        lr=args.lr,
        batch_size=args.batch_size,
        buffer_size=args.buffer_size,
        warmup_steps=args.warmup_steps,
        target_sync_every=args.target_sync_every,
        eps_end=args.eps_end,
        eps_decay_steps=args.eps_decay_steps,
        train_every=args.train_every,
        max_moves=args.max_moves,
    )

    with GrpcGameEnv(args.address, game_type=args.game) as env:
        agent = build_agent(env, cfg, args.device, args.resume)
        print(f"device={agent.device} episodes={args.episodes} out={args.out}")
        train(
            env,
            agent,
            episodes=args.episodes,
            out=Path(args.out),
            eval_every=args.eval_every,
            eval_games=args.eval_games,
            save_every=args.save_every,
            log_every=args.log_every,
        )


if __name__ == "__main__":
    main()
