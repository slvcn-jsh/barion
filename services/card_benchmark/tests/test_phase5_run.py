from pathlib import Path

import pytest

from services.card_benchmark.phase5_run import run


def test_phase5_run_is_hash_linked_and_immutable(tmp_path):
    parent = Path("tmp/card-benchmark/phase4-evaluation-runs/c22c1ea010b5e54e6df3b0a1")
    fixtures = Path("services/card_evaluation/fixtures/authorities.json")
    if not parent.is_dir():
        pytest.skip("Canonical Phase 4 run unavailable")
    output = run(parent, tmp_path, fixtures)
    assert (output / "manifest.json").is_file()
    with pytest.raises(ValueError, match="immutable"):
        run(parent, tmp_path, fixtures)
