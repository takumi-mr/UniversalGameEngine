"""gRPC Simulate / BatchSimulate のスループットを測る（木探索が実用速度で回るかの確認用）。

    RL_MODE=true の backend を起動した上で:
    python apps/ml/scripts/bench_simulate.py --address localhost:50051
"""

from __future__ import annotations

import argparse
import random
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from uge_rl.env import GrpcGameEnv  # noqa: E402


def bench_unary(env: GrpcGameEnv, n: int) -> float:
    """1 手ずつ Simulate を連鎖させる（1 RPC = 1 ノード展開）。"""
    _, legal, active = env.reset()
    state, mover = env.state_json, active[0]
    t0 = time.perf_counter()
    for _ in range(n):
        res = env.simulate(state, mover, int(random.choice(legal.tolist())))
        assert res.ok, res.error
        if res.done:
            _, legal, active = env.reset()
            state, mover = env.state_json, active[0]
        else:
            state, mover, legal = res.state_json, res.next_player, res.legal_actions
    return n / (time.perf_counter() - t0)


def bench_batch(env: GrpcGameEnv, n: int, batch: int) -> float:
    """ルート局面の合法手を batch 件になるまで並べて一括展開（MCTS の展開に相当）。"""
    _, legal, active = env.reset()
    root, mover = env.state_json, active[0]
    items = [(root, mover, int(legal[i % len(legal)])) for i in range(batch)]
    done = 0
    t0 = time.perf_counter()
    while done < n:
        results = env.simulate_batch(items)
        assert all(r.ok for r in results)
        done += len(results)
    return done / (time.perf_counter() - t0)


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--address", default="localhost:50051")
    p.add_argument("--game", default="othello")
    p.add_argument("--n", type=int, default=3000)
    p.add_argument("--batches", default="16,64,256")
    args = p.parse_args()

    with GrpcGameEnv(args.address, game_type=args.game) as env:
        print(f"unary Simulate   : {bench_unary(env, args.n):8.0f} sims/s")
        for b in (int(x) for x in args.batches.split(",")):
            print(f"BatchSimulate x{b:<4}: {bench_batch(env, args.n, b):8.0f} sims/s")


if __name__ == "__main__":
    main()
