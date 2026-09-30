from __future__ import annotations

import argparse
from pathlib import Path

from dotenv import load_dotenv
import uvicorn


def load_local_environment(env_path: Path | None = None) -> None:
    load_dotenv(env_path or Path(__file__).with_name(".env"), override=True)


def main() -> None:
    parser = argparse.ArgumentParser(description="Run Barion AI gateway with local service environment.")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8790)
    args = parser.parse_args()

    # Local development deliberately uses service-owned secrets even when a
    # parent shell still contains an older provider key. Production starts
    # uvicorn directly so deployment-managed environment values keep priority.
    load_local_environment()
    uvicorn.run("services.ai_gateway.main:app", host=args.host, port=args.port)


if __name__ == "__main__":
    main()
