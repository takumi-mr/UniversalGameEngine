"""packages/shared/network/game.proto から Python の gRPC スタブを生成する。

    python apps/ml/scripts/gen_proto.py

生成物: apps/ml/proto/game_pb2.py, game_pb2_grpc.py
"""

from __future__ import annotations

import sys
from pathlib import Path

from grpc_tools import protoc

ML_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = ML_ROOT.parents[1]
PROTO_DIR = REPO_ROOT / "packages" / "shared" / "network"
OUT_DIR = ML_ROOT / "proto"


def main() -> int:
    OUT_DIR.mkdir(exist_ok=True)
    (OUT_DIR / "__init__.py").touch()
    args = [
        "protoc",
        f"-I{PROTO_DIR}",
        f"--python_out={OUT_DIR}",
        f"--grpc_python_out={OUT_DIR}",
        str(PROTO_DIR / "game.proto"),
    ]
    rc = protoc.main(args)
    if rc != 0:
        return rc

    # grpc_tools は `import game_pb2` という絶対 import を吐くので、パッケージ相対に書き換える
    grpc_file = OUT_DIR / "game_pb2_grpc.py"
    text = grpc_file.read_text(encoding="utf-8")
    text = text.replace("import game_pb2 as game__pb2", "from . import game_pb2 as game__pb2")
    grpc_file.write_text(text, encoding="utf-8")
    print(f"generated: {OUT_DIR / 'game_pb2.py'}, {grpc_file}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
