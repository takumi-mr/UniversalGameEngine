"""学習済みモデルの保存・読み込み（DQN / AlphaZero 共通）。

保存形式: 1 つの .pt ファイル（torch.save）に
  - model_state : ネットワークの state_dict
  - meta        : format（"uge-rl/dqn/v1" | "uge-rl/az/v1"）、ゲーム種別・観測次元・行動数・学習ステップ数など
同名の .json にも meta を書き出す。読み込み時は meta["format"] でエージェント種別を判別する。
"""

from __future__ import annotations

import json
import subprocess
from datetime import datetime, timezone
from pathlib import Path

import torch

from .az_agent import AZAgent, AZConfig
from .dqn import DQNAgent, DQNConfig
from .games import get_game_spec

Agent = DQNAgent | AZAgent


def _git_commit() -> str | None:
    try:
        return subprocess.check_output(
            ["git", "rev-parse", "--short", "HEAD"], text=True, stderr=subprocess.DEVNULL
        ).strip()
    except Exception:  # noqa: BLE001
        return None


def save_checkpoint(agent: Agent, path: str | Path, extra: dict | None = None) -> Path:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    meta = {
        **agent.checkpoint_meta(),
        "saved_at": datetime.now(timezone.utc).isoformat(),
        "git_commit": _git_commit(),
        **(extra or {}),
    }
    torch.save({"model_state": agent.state_dict(), "meta": meta}, path)
    path.with_suffix(".json").write_text(
        json.dumps(meta, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    return path


def load_checkpoint(path: str | Path, device: str | None = None) -> tuple[Agent, dict]:
    ckpt = torch.load(Path(path), map_location="cpu", weights_only=False)
    meta = ckpt["meta"]
    spec = get_game_spec(meta["game_type"], meta["obs_dim"])
    fmt = meta.get("format", DQNAgent.FORMAT)

    agent: Agent
    if fmt == AZAgent.FORMAT:
        agent = AZAgent(spec, meta["obs_dim"], AZConfig.from_dict(meta["config"]), device=device)
    elif fmt == DQNAgent.FORMAT:
        agent = DQNAgent(spec, meta["obs_dim"], DQNConfig(**meta["config"]), device=device)
    else:
        raise ValueError(f"unknown checkpoint format: {fmt}")
    agent.load_state(ckpt["model_state"], meta)
    return agent, meta
