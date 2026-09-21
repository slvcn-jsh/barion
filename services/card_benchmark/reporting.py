from __future__ import annotations

import csv
import json
from dataclasses import asdict
from pathlib import Path
from typing import Any

from .io_utils import sha256_text, write_json, write_jsonl
from .models import Card, NormalizedCard


def write_csv(path: Path, rows: list[dict[str, Any]], fieldnames: list[str] | None = None) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fieldnames = fieldnames or sorted({key for row in rows for key in row})
    if not fieldnames:
        path.write_text("", encoding="utf-8")
        return
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)


def render_markdown(manifest: dict[str, Any], summaries: dict[str, dict[str, Any]], match_count: int,
                    warnings: list[str], grounding_audit: dict[str, object] | None = None,
                    evaluation: dict[str, Any] | None = None) -> str:
    lines = ["# Card benchmark evaluation", "", f"Run ID: `{manifest['runId']}`", "",
             "## Reproducibility", "", f"- Source SHA-256: `{manifest['inputs']['sourceSha256']}`",
             f"- Extracted text SHA-256: `{manifest['hashes']['extractedTextSha256']}`",
             f"- Segment SHA-256: `{manifest['hashes']['segmentSha256']}`",
             f"- Normalized Barion deck SHA-256: `{manifest['hashes']['productionDeckSha256']}`",
             f"- Git commit: `{manifest['gitCommit']}`", f"- Production model: `{manifest['generation']['model']}`",
             f"- Evaluator versions: `{json.dumps(manifest['versions'], sort_keys=True)}`"]
    if evaluation:
        lines += ["", "## Phase 1 evaluation", "",
                  f"- Claims: **{evaluation.get('claimCount', 0)}**",
                  f"- Grounding statuses: `{json.dumps(evaluation.get('groundingStatuses', {}), sort_keys=True)}`",
                  f"- Citation statuses: `{json.dumps(evaluation.get('citationStatuses', {}), sort_keys=True)}`",
                  f"- Risks: `{json.dumps(evaluation.get('riskCounts', {}), sort_keys=True)}`",
                  f"- Publication decisions: `{json.dumps(evaluation.get('decisions', {}), sort_keys=True)}`",
                  f"- Contradictions: **{evaluation.get('contradictions', 0)}**",
                  f"- Critical failures: **{evaluation.get('criticalFailures', 0)}**"]
    if warnings:
        lines += ["", "## Warnings", ""] + [f"- {warning}" for warning in warnings]
    production_coverage = summaries.get("production", {}).get("phase2Coverage", {})
    quizlet_coverage = summaries.get("quizlet", {}).get("phase2Coverage", {})
    if production_coverage or quizlet_coverage:
        lines += ["", "## Phase 2 concept coverage", "",
                  f"- Frozen eligible concepts: **{production_coverage.get('eligibleConceptCount', quizlet_coverage.get('eligibleConceptCount', 0))}**",
                  f"- Barion importance-weighted coverage: **{production_coverage.get('sourceCoverage', 0):.1%}**",
                  f"- Quizlet importance-weighted coverage: **{quizlet_coverage.get('sourceCoverage', 0):.1%}**",
                  f"- Coverage weights: `{json.dumps(production_coverage.get('weightConfig', quizlet_coverage.get('weightConfig', {})), sort_keys=True)}`"]
    lines += ["", "## Phase 3 semantic matching and blind review", "",
              f"- Source-constrained semantic pairs: **{match_count}**",
              "- Complete `blind_review.csv` independently with at least two reviewers.",
              "- Keep `private/blind_review_key.json` hidden until reviews are locked.",
              "- Score completed files with `python -m services.card_benchmark.review_score --run <run> --reviews <reviewer-1.csv> <reviewer-2.csv>`.",
              "", "## Scope", "",
              "Semantic matching selects same-source comparison pairs; it does not establish medical truth. Comparative claims remain blocked until review acceptance gates pass.", ""]
    return "\n".join(lines)


def run_id(*identity_parts: str) -> str:
    return sha256_text(":".join(identity_parts))[:24]


def assert_compatible_artifacts(manifests: list[dict[str, Any]]) -> None:
    if not manifests:
        return
    identity = ("sourceSha256", "extractedTextSha256", "segmentSha256", "quizletDeckSha256",
                "productionDeckSha256", "evaluatorConfigSha256")
    expected = tuple(manifests[0]["hashes"].get(key) for key in identity)
    expected_versions = manifests[0]["versions"]
    for manifest in manifests[1:]:
        actual = tuple(manifest["hashes"].get(key) for key in identity)
        if actual != expected or manifest["versions"] != expected_versions:
            raise ValueError("Benchmark artifacts have different input hashes or evaluator versions; refusing to combine stale/mixed artifacts.")


def write_artifacts(output: Path, manifest: dict[str, Any], concepts: list[Any], cards: dict[str, list[Card | NormalizedCard]],
                    analyzed: dict[str, list[dict[str, Any]]], summaries: dict[str, dict[str, Any]],
                    matches: list[dict[str, Any]], warnings: list[str], review_limit: int,
                    grounding_audit: tuple[dict[str, object], list[dict[str, object]]] | None = None,
                    claim_rows: list[dict[str, Any]] | None = None,
                    evaluation_summary: dict[str, Any] | None = None,
                    regressions: tuple[dict[str, object], list[dict[str, object]]] | None = None,
                    structural_units: list[Any] | None = None,
                    coverage: dict[str, dict[str, Any]] | None = None,
                    semantic_calibration: tuple[dict[str, object], list[dict[str, object]]] | None = None,
                    blind_review: tuple[list[dict[str, object]], list[dict[str, object]], dict[str, object]] | None = None) -> None:
    if output.exists():
        raise ValueError(f"Run output already exists; completed runs are immutable: {output}")
    output.mkdir(parents=True, exist_ok=False)
    write_json(output / "manifest.json", manifest)
    write_json(output / "concept_inventory.json", [asdict(item) for item in concepts])
    write_json(output / "structural_source.json", [asdict(item) for item in (structural_units or [])])
    write_json(output / "coverage_map.json", coverage or {})
    audit_summary, audit_rows = grounding_audit or ({}, [])
    regression_summary, regression_rows = regressions or ({}, [])
    calibration_summary, calibration_rows = semantic_calibration or ({}, [])
    review_rows, review_key, protocol = blind_review or ([], [], {})
    write_json(output / "metrics.json", {"systems": summaries, "crossSystemMatchCount": len(matches),
                                         "productionGroundingAudit": audit_summary,
                                         "phase1Evaluation": evaluation_summary or {},
                                         "knownRegressions": regression_summary,
                                         "semanticCalibration": calibration_summary,
                                         "blindReviewReadiness": {
                                             "pairCount": len(review_rows),
                                             "acceptanceGates": protocol.get("acceptanceGates", {}),
                                             "status": "ready" if len(review_rows) >= int(protocol.get("acceptanceGates", {}).get("minimumPairs", 30)) else "insufficient-pairs",
                                         }})
    write_json(output / "semantic_calibration.json", calibration_rows)
    write_json(output / "blind_review_protocol.json", protocol)
    review_fields = ["pairId", "sourceLocator", "sourceProposition", "cardAQuestion", "cardAAnswer",
                     "cardBQuestion", "cardBAnswer", "reviewerId", "accuracyA", "accuracyB", "clarityA",
                     "clarityB", "learningValueA", "learningValueB", "preference", "exclusionReason", "notes"]
    write_csv(output / "blind_review.csv", review_rows, review_fields)
    write_json(output / "private" / "blind_review_key.json", review_key)
    write_json(output / "regression_results.json", regression_rows)
    write_jsonl(output / "claims.jsonl", claim_rows or [])
    write_csv(output / "claims.csv", claim_rows or [])
    write_json(output / "matches.json", matches)
    for system in ("production", "quizlet"):
        write_json(output / f"{system}_cards.json", [asdict(item) for item in cards[system]])
        write_csv(output / f"{system}_cards.csv", analyzed[system])
    (output / "report.md").write_text(
        render_markdown(manifest, summaries, len(matches), warnings, audit_summary, evaluation_summary), encoding="utf-8"
    )
