"""Universal Game Engine の gRPC RL API (Reset/Step) を使う強化学習クライアント。"""

from .env import GrpcGameEnv, StepResult
from .games import GameSpec, get_game_spec

__all__ = ["GrpcGameEnv", "StepResult", "GameSpec", "get_game_spec"]
