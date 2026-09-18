"""AlphaZero 風の自己対戦学習ループ（探索は gRPC Simulate / BatchSimulate）。

    # 事前に RL_MODE=true でバックエンドを起動しておく（task rl）
    python -m uge_rl.train_az --game othello --iterations 30 --out models/othello_az.pt

1 イテレーション = 自己対戦 games_per_iter 局（MCTS の訪問回数分布を教師に記録）
                 → train_steps_per_iter 回の勾配更新（policy: 交差エントロピー, value: MSE）
                 → 対ランダム評価（eval_every ごと）→ チェックポイント保存
"""

from __future__ import annotations

import argparse
import random
import sys
import time
from pathlib import Path

import numpy as np
import torch

from .az_agent import AZAgent, AZConfig
from .checkpoint import load_checkpoint, save_checkpoint
from .env import GrpcGameEnv
from .evaluate import play_vs_random
from .games import get_game_spec
from .mcts import MCTSConfig


def train(
    env: GrpcGameEnv,
    agent: AZAgent,
    iterations: int,
    out: Path,
    eval_every: int = 5,
    eval_games: int = 20,
    save_every: int = 1,
) -> list[tuple[int, float]]:
    eval_history: list[tuple[int, float]] = []
    t0 = time.time()

    for it in range(1, iterations + 1):
        # --- 自己対戦
        t_sp = time.time()
        lengths: list[int] = []
        first_results: list[float] = []
        for _ in range(agent.cfg.games_per_iter):
            moves, first = agent.self_play_game(env)
            lengths.append(moves)
            first_results.append(first)
        sp_sec = time.time() - t_sp

        # --- 学習
        t_tr = time.time()
        p_losses: list[float] = []
        v_losses: list[float] = []
        for _ in range(agent.cfg.train_steps_per_iter):
            r = agent.train_step()
            if r is not None:
                p_losses.append(r[0])
                v_losses.append(r[1])
        tr_sec = time.time() - t_tr

        fr = np.asarray(first_results)
        print(
            f"[iter {it:>4}] games={agent.games_played} buffer={len(agent.buffer)} "
            f"len={np.mean(lengths):.1f} first(W/D/L)={int((fr > 0).sum())}/{int((fr == 0).sum())}/{int((fr < 0).sum())} "
            f"p_loss={np.mean(p_losses) if p_losses else float('nan'):.3f} "
            f"v_loss={np.mean(v_losses) if v_losses else float('nan'):.3f} "
            f"self-play={sp_sec:.0f}s train={tr_sec:.0f}s total={time.time() - t0:.0f}s",
            flush=True,
        )

        if eval_every and it % eval_every == 0:
            result = play_vs_random(agent, env, games=eval_games, max_moves=agent.cfg.max_moves)
            eval_history.append((agent.games_played, result.win_rate))
            print(f"[eval iter {it}] vs random (sims={agent.cfg.eval_simulations}): {result}", flush=True)

        if save_every and it % save_every == 0:
            save_checkpoint(agent, out, extra={"iterations": it, "eval_history": eval_history})

    save_checkpoint(agent, out, extra={"iterations": iterations, "eval_history": eval_history})
    print(f"[save] final model -> {out}", flush=True)
    return eval_history


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--game", default="othello")
    p.add_argument("--address", default="localhost:50051")
    p.add_argument("--iterations", type=int, default=30)
    p.add_argument("--out", default="models/othello_az.pt")
    p.add_argument("--resume", default=None)
    p.add_argument("--device", default=None)
    p.add_argument("--seed", type=int, default=0)
    p.add_argument("--eval-every", type=int, default=5)
    p.add_argument("--eval-games", type=int, default=20)
    p.add_argument("--save-every", type=int, default=1)
    # AlphaZero ハイパーパラメータ
    p.add_argument("--games-per-iter", type=int, default=AZConfig.games_per_iter)
    p.add_argument("--train-steps-per-iter", type=int, default=AZConfig.train_steps_per_iter)
    p.add_argument("--simulations", type=int, default=MCTSConfig.n_simulations, help="自己対戦時の 1 手あたり探索回数")
    p.add_argument("--sim-batch", type=int, default=MCTSConfig.batch_size, help="1 回の BatchSimulate で展開する葉の数")
    p.add_argument("--eval-simulations", type=int, default=AZConfig.eval_simulations)
    p.add_argument("--c-puct", type=float, default=MCTSConfig.c_puct)
    p.add_argument(
        "--dirichlet-alpha",
        type=float,
        default=MCTSConfig.dirichlet_alpha,
        help="ルートノイズの Dirichlet α（合法手が多いゲームほど小さく。将棋は 0.15 程度）",
    )
    p.add_argument("--temp-moves", type=int, default=AZConfig.temp_moves)
    p.add_argument("--max-moves", type=int, default=AZConfig.max_moves, help="1 局の手数上限（0 = 無制限）。超えたら引き分け")
    p.add_argument("--channels", type=int, default=AZConfig.channels)
    p.add_argument("--blocks", type=int, default=AZConfig.blocks)
    p.add_argument("--lr", type=float, default=AZConfig.lr)
    p.add_argument("--batch-size", type=int, default=AZConfig.batch_size)
    p.add_argument("--buffer-size", type=int, default=AZConfig.buffer_size)
    args = p.parse_args()

    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    random.seed(args.seed)
    np.random.seed(args.seed)
    torch.manual_seed(args.seed)

    cfg = AZConfig(
        channels=args.channels,
        blocks=args.blocks,
        lr=args.lr,
        batch_size=args.batch_size,
        buffer_size=args.buffer_size,
        train_steps_per_iter=args.train_steps_per_iter,
        games_per_iter=args.games_per_iter,
        temp_moves=args.temp_moves,
        eval_simulations=args.eval_simulations,
        max_moves=args.max_moves,
        mcts=MCTSConfig(
            n_simulations=args.simulations,
            batch_size=args.sim_batch,
            c_puct=args.c_puct,
            dirichlet_alpha=args.dirichlet_alpha,
        ),
    )

    with GrpcGameEnv(args.address, game_type=args.game) as env:
        if args.resume:
            agent, meta = load_checkpoint(args.resume, device=args.device)
            if not isinstance(agent, AZAgent):
                raise SystemExit(f"{args.resume} is not an AlphaZero checkpoint (format={meta['format']})")
            print(f"resumed from {args.resume} (games={meta['games_played']})")
        else:
            obs, _, _ = env.reset()
            spec = get_game_spec(env.game_type, obs.shape[0])
            print(f"game spec: {spec.description}")
            agent = AZAgent(spec, obs.shape[0], cfg, device=args.device)
        print(
            f"device={agent.device} iterations={args.iterations} games/iter={agent.cfg.games_per_iter} "
            f"sims={agent.cfg.mcts.n_simulations} out={args.out}"
        )
        train(
            env,
            agent,
            iterations=args.iterations,
            out=Path(args.out),
            eval_every=args.eval_every,
            eval_games=args.eval_games,
            save_every=args.save_every,
        )


if __name__ == "__main__":
    main()
