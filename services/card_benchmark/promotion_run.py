from __future__ import annotations

import argparse
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .io_utils import canonical_json, read_json, sha256_file, sha256_text, write_json
from .optimization import (
    PROMOTION_GATE_VERSION,
    ModelPromotionThresholds,
    model_promotion_decision,
    validate_evaluation_run_record,
)

PROMOTION_RUN_VERSION = "1.0.0"

_THRESHOLD_FIELDS = {
    "minGroundingFaithfulness": "min_grounding_faithfulness",
    "maxUnsupportedClaimRate": "max_unsupported_claim_rate",
    "minConceptCoverage": "min_concept_coverage",
    "minAtomicityScore": "min_atomicity_score",
    "minAnswerSpecificity": "min_answer_specificity",
    "maxDuplicateRate": "max_duplicate_rate",
    "minProvenanceAccuracy": "min_provenance_accuracy",
    "minSchemaValidity": "min_schema_validity",
    "minQualityGateAcceptanceRate": "min_quality_gate_acceptance_rate",
    "minHumanAcceptanceRate": "min_human_acceptance_rate",
    "maxHumanEditRate": "max_human_edit_rate",
    "maxLatencyP95Ms": "max_latency_p95_ms",
    "maxLatencyRegressionRatio": "max_latency_regression_ratio",
    "maxEstimatedCost": "max_estimated_cost",
    "maxCostRegressionRatio": "max_cost_regression_ratio",
    "maxProviderFailureRate": "max_provider_failure_rate",
}


def run(
    baseline_path: Path,
    candidate_path: Path,
    thresholds_path: Path,
    output_root: Path,
) -> Path:
    baseline_path = baseline_path.resolve()
    candidate_path = candidate_path.resolve()
    thresholds_path = thresholds_path.resolve()
    baseline = _evaluation_run(baseline_path, "baseline")
    candidate = _evaluation_run(candidate_path, "candidate")
    _validate_comparable(baseline, candidate)
    threshold_payload = read_json(thresholds_path)
    thresholds = _parse_thresholds(threshold_payload)

    input_hashes = {
        "baseline": sha256_file(baseline_path),
        "candidate": sha256_file(candidate_path),
        "thresholds": sha256_file(thresholds_path),
    }
    run_id = sha256_text(canonical_json({
        "inputs": input_hashes,
        "promotionGateVersion": PROMOTION_GATE_VERSION,
        "promotionRunVersion": PROMOTION_RUN_VERSION,
    }))[:24]
    output = output_root.resolve() / run_id
    if output.exists():
        raise ValueError(f"Promotion run already exists and is immutable: {output}")

    decision = model_promotion_decision(
        baseline["metrics"],
        candidate["metrics"],
        thresholds,
    )
    created_at = datetime.now(timezone.utc).isoformat()
    manifest = {
        "runId": run_id,
        "promotionRunVersion": PROMOTION_RUN_VERSION,
        "promotionGateVersion": PROMOTION_GATE_VERSION,
        "createdAt": created_at,
        "immutable": True,
        "networkUsed": False,
        "paidGeneration": False,
        "inputs": input_hashes,
        "baselineIdentity": baseline["identity"],
        "candidateIdentity": candidate["identity"],
        "decision": decision["decision"],
    }
    output.mkdir(parents=True, exist_ok=False)
    write_json(output / "manifest.json", manifest)
    write_json(output / "promotion_decision.json", {
        **decision,
        "runId": run_id,
        "createdAt": created_at,
        "baselineIdentity": baseline["identity"],
        "candidateIdentity": candidate["identity"],
    })
    return output


def _evaluation_run(path: Path, label: str) -> dict[str, Any]:
    payload = read_json(path)
    try:
        validate_evaluation_run_record(payload)
    except ValueError as error:
        raise ValueError(f"{label} evaluation run is invalid: {error}") from error
    return payload


def _validate_comparable(baseline: dict[str, Any], candidate: dict[str, Any]) -> None:
    for field in ("datasetVersion", "schemaVersion"):
        baseline_value = baseline["identity"].get(field)
        candidate_value = candidate["identity"].get(field)
        if not baseline_value or baseline_value != candidate_value:
            raise ValueError(f"Promotion comparison requires matching {field}.")


def _parse_thresholds(payload: Any) -> ModelPromotionThresholds:
    if not isinstance(payload, dict):
        raise ValueError("Promotion thresholds must be a JSON object.")
    missing = sorted(set(_THRESHOLD_FIELDS) - set(payload))
    unknown = sorted(set(payload) - set(_THRESHOLD_FIELDS))
    if missing or unknown:
        raise ValueError(
            f"Promotion threshold keys are invalid; missing={missing}, unknown={unknown}."
        )
    values = {}
    for external_name, internal_name in _THRESHOLD_FIELDS.items():
        value = payload[external_name]
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise ValueError(f"Promotion threshold {external_name} must be numeric.")
        values[internal_name] = float(value)
    return ModelPromotionThresholds(**values)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Create immutable model-promotion evidence.")
    parser.add_argument("--baseline", type=Path, required=True)
    parser.add_argument("--candidate", type=Path, required=True)
    parser.add_argument("--thresholds", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args(argv)
    print(run(args.baseline, args.candidate, args.thresholds, args.output))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
