import json
from pathlib import Path

from services.ai_gateway.errors import GatewayError
from services.card_benchmark import cli
from services.card_benchmark.cli import main
from services.card_benchmark.extraction import extract_source_pages, segment_pages

ROOT = Path(__file__).resolve().parents[3]
SOURCE = ROOT / "tmp" / "card-benchmark" / "PDF_INPUT.pdf"
QUIZLET = ROOT / "tmp" / "card-benchmark" / "QUIZLET_OUTPUT.pdf"


def test_full_cached_pipeline_writes_deterministic_artifacts(tmp_path):
    if not SOURCE.exists() or not QUIZLET.exists():
        return
    cache = tmp_path / "production.json"
    _count, pages = extract_source_pages(SOURCE)
    segment = segment_pages(pages, "Comprehensive Psychiatric Nursing Review")[0]
    cache.write_text(json.dumps({
        "requestId": "cached-request", "provider": "gemini", "model": "test-model",
        "output": {"candidates": [{
            "segmentId": segment.segmentId, "cardType": "definition",
            "learningObjective": "Recall the concept definition.",
            "question": "What is the defined psychiatric nursing concept?",
            "answer": "Answer: A supported concept.\nWhy it matters: Review.\nStudy note: Recall it.",
            "evidenceText": segment.text[:80],
        }]},
        "usage": {"inputTokens": 10, "outputTokens": 10},
    }), encoding="utf-8")
    output = tmp_path / "report"
    args = ["--source", str(SOURCE), "--quizlet", str(QUIZLET), "--production-cache", str(cache),
            "--output", str(output), "--model", "test-model", "--review-limit", "5"]
    request_id = cli.build_request(segment_pages(pages, "Comprehensive Psychiatric Nursing Review"), "Comprehensive Psychiatric Nursing Review", "test-model").requestId
    payload = json.loads(cache.read_text(encoding="utf-8")); payload["requestId"] = request_id
    cache.write_text(json.dumps(payload), encoding="utf-8")
    assert main(args) == 0
    run_dir = next(output.iterdir())
    first = {path.name: path.read_bytes() if path.is_file() else None for path in run_dir.iterdir()}
    assert main(args) == 2
    assert len(list(output.iterdir())) == 1
    assert {"manifest.json", "metrics.json", "report.md", "claims.jsonl", "claims.csv",
            "regression_results.json", "structural_source.json", "concept_inventory.json",
            "coverage_map.json", "matches.json", "semantic_calibration.json", "blind_review.csv",
            "blind_review_protocol.json", "private"} <= set(first)
    assert "production_grounding_review.csv" not in first
    manifest = json.loads(first["manifest.json"])
    metrics = json.loads(first["metrics.json"])
    regressions = json.loads(first["regression_results.json"])
    concepts = json.loads(first["concept_inventory.json"])
    coverage = json.loads(first["coverage_map.json"])
    structural = json.loads(first["structural_source.json"])
    report = first["report.md"].decode("utf-8")
    assert manifest["generation"]["quantityContractMet"] is False
    assert metrics["knownRegressions"] == {
        "caseCount": 10, "failed": 0, "fixtureVersion": "1.0.0", "passed": 10,
    }
    assert len(regressions) == 10
    assert all(row["passed"] for row in regressions)
    assert concepts and all(item["sourceSpans"] and item["inventoryVersion"] == "2.0.0" for item in concepts)
    assert structural and {"production", "quizlet"} == set(coverage)
    assert coverage["production"]["weightConfig"]["version"] == "1.0.0"
    assert metrics["semanticCalibration"]["passed"] is True
    assert metrics["blindReviewReadiness"]["status"] == "insufficient-pairs"
    assert json.loads((run_dir / "private" / "blind_review_key.json").read_text(encoding="utf-8")) == []
    assert report.startswith("# Card benchmark evaluation")
    assert "Phase 2 concept coverage" in report
    assert "Phase 3 semantic matching and blind review" in report
    assert "SEVERE UNDERPRODUCTION" in report


def test_main_prints_provider_diagnostics_without_secrets(monkeypatch, capsys):
    monkeypatch.setattr(
        cli,
        "execute",
        lambda _args: (_ for _ in ()).throw(GatewayError(
            "provider_rejected_request",
            "Generation provider rejected the request.",
            502,
            False,
            "gemini",
            {"attempt": 1, "providerStatus": 400, "providerError": {"message": "Invalid schema"}},
        )),
    )

    assert main([]) == 2
    error_output = capsys.readouterr().err
    assert "Generation provider rejected the request." in error_output
    assert '"providerStatus": 400' in error_output
    assert '"attempt": 1' in error_output


def test_remote_is_blocked_without_explicit_flag(tmp_path, capsys):
    if not SOURCE.exists() or not QUIZLET.exists():
        return
    result = main(["--source", str(SOURCE), "--quizlet", str(QUIZLET),
                   "--production-cache", str(tmp_path / "missing.json"), "--output", str(tmp_path / "report")])
    assert result == 2
    assert "Remote generation blocked" in capsys.readouterr().err


def test_dry_run_reports_incompatible_cache(tmp_path, capsys):
    if not SOURCE.exists() or not QUIZLET.exists():
        return
    cache = tmp_path / "production.json"
    cache.write_text(json.dumps({
        "requestId": "stale-request", "provider": "gemini", "model": "test-model",
        "output": {"candidates": []}, "usage": None,
    }), encoding="utf-8")

    result = main(["--source", str(SOURCE), "--quizlet", str(QUIZLET), "--dry-run",
                   "--production-cache", str(cache), "--model", "test-model"])

    assert result == 0
    generation = json.loads(capsys.readouterr().out)["generation"]
    assert generation["status"] == "cache-incompatible"
    assert "stale artifact mixing" in generation["cacheError"]
