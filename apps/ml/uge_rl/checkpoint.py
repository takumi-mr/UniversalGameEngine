"""学習済みモデルの保存・読み込み。

保存形式: 1 つの .pt ファイル（torch.save）に
  - model_state : Q ネットワークの state_dict
  - meta        : ゲーム種別・観測次元・行動数・学習ステップ数など（同名 .json にも書き出す）
"""

from __future__ import annotations

import json
import subprocess
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path

import torch

from .dqn import DQNAgent, DQNConfig
from .games import get_game_spec


def _git_commit() -> str | None:
    try:
        return subprocess.check_output(
            ["git", "rev-parse", "--short", "HEAD"], text=True, stderr=subprocess.DEVNULL
        ).strip()
    except Exception:  # noqa: BLE001
        return None


def save_checkpoint(agent: DQNAgent, path: str | Path, extra: dict | None = None) -> Path:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    meta = {
        "format": "uge-rl/dqn/v1",
        "game_type": agent.spec.game_type,
        "obs_dim": agent.obs_dim,
        "obs_shape": list(agent.spec.obs_shape) if agent.spec.obs_shape else None,
        "n_actions": agent.spec.n_actions,
        "arch": type(agent.q).__name__,
        "config": asdict(agent.cfg),
        "total_steps": agent.total_steps,
        "train_steps": agent.train_steps,
        "epsilon": agent.epsilon,
        "saved_at": datetime.now(timezone.utc).isoformat(),
        "git_commit": _git_commit(),
        **(extra or {}),
    }
    torch.save({"model_state": agent.q.state_dict(), "meta": meta}, path)
    path.with_suffix(".json").write_text(
        json.dumps(meta, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    return path


def load_checkpoint(path: str | Path, device: str | None = None) -> tuple[DQNAgent, dict]:
    ckpt = torch.load(Path(path), map_location="cpu", weights_only=False)
    meta = ckpt["meta"]
    spec = get_game_spec(meta["game_type"], meta["obs_dim"])
    cfg = DQNConfig(**meta["config"])
    agent = DQNAgent(spec, meta["obs_dim"], cfg, device=device)
    agent.q.load_state_dict(ckpt["model_state"])
    agent.q_target.load_state_dict(ckpt["model_state"])
    agent.total_steps = meta.get("total_steps", 0)
    agent.train_steps = meta.get("train_steps", 0)
    return agent, meta
