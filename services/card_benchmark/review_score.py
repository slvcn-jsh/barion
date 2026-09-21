from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .blind_review import score_review_files
from .io_utils import write_json


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Score completed independent blind card-review files.")
    parser.add_argument("--run", type=Path, required=True, help="Immutable benchmark run directory.")
    parser.add_argument("--reviews", type=Path, nargs="+", required=True, help="Completed CSV; one reviewerId per file.")
    parser.add_argument("--output", type=Path, help="Output JSON; defaults to stdout only.")
    args = parser.parse_args(argv)
    try:
        result = score_review_files(args.run.resolve(), [path.resolve() for path in args.reviews])
        if args.output:
            write_json(args.output.resolve(), result)
        print(json.dumps(result, ensure_ascii=False, sort_keys=True, indent=2))
        return 0 if result["status"] == "PASS" else 1
    except (OSError, ValueError) as error:
        print(f"review scoring error: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
