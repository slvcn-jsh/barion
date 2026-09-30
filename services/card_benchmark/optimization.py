from __future__ import annotations
import hashlib, math, re
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any
from .io_utils import canonical_json, sha256_text

OPTIMIZATION_VERSION = "1.0.0"
SPLIT_VERSION = "1.0.0"
EXPERIMENT_VERSION = "1.0.0"
QUALITY_GATE_VERSION = "1.0.0"
PROMOTION_GATE_VERSION = "1.0.0"
EVALUATION_RUN_VERSION = "1.0.0"
ROOT_CAUSES = frozenset({
    "PARSING", "OCR", "SEGMENTATION", "TABLE_EXTRACTION", "CONCEPT_INVENTORY", "RETRIEVAL",
    "CONTEXT_SELECTION", "GENERATION_PROMPT", "GENERATION_MODEL", "SCHEMA", "CLAIM_EXTRACTION",
    "GROUNDING", "CITATION", "MEDICAL_VERIFICATION", "MATCHING", "PEDAGOGY", "DUPLICATION",
    "COVERAGE", "ATOMICITY", "VERBOSITY", "POLICY", "PROVIDER_RELIABILITY", "OTHER",
})

@dataclass(frozen=True, slots=True)
class DatasetSplit:
    datasetId: str
    version: str
    seed: str
    development: tuple[str, ...]
    validation: tuple[str, ...]
    holdout: tuple[str, ...]
    holdoutAccessedAt: str = ""
    holdoutAccessReason: str = ""

@dataclass(frozen=True, slots=True)
class Experiment:
    experimentId: str
    hypothesis: str
    rootCause: str
    singleIntervention: dict[str, str]
    baselineRun: str
    candidateRun: str
    developmentResult: dict[str, Any]
    validationResult: dict[str, Any]
    holdoutResult: dict[str, Any]
    safetyDelta: float
    groundingDelta: float
    coverageDelta: float
    pedagogyDelta: float
    costDelta: float | None
    latencyDelta: float | None
    decision: str
    reason: str
    version: str = EXPERIMENT_VERSION
    def __post_init__(self):
        if self.rootCause not in ROOT_CAUSES: raise ValueError("Unknown root-cause category.")
        if len(self.singleIntervention) != 1: raise ValueError("Experiment must change exactly one intervention.")
        if self.decision not in {"ACCEPT", "REJECT", "INCONCLUSIVE"}: raise ValueError("Unknown experiment decision.")


@dataclass(frozen=True, slots=True)
class ModelPromotionThresholds:
    min_grounding_faithfulness: float
    max_unsupported_claim_rate: float
    min_concept_coverage: float
    min_atomicity_score: float
    min_answer_specificity: float
    max_duplicate_rate: float
    min_provenance_accuracy: float
    min_schema_validity: float
    min_quality_gate_acceptance_rate: float
    min_human_acceptance_rate: float
    max_human_edit_rate: float
    max_latency_p95_ms: float
    max_latency_regression_ratio: float
    max_estimated_cost: float
    max_cost_regression_ratio: float
    max_provider_failure_rate: float

    def __post_init__(self):
        for name in self.__dataclass_fields__:
            value = getattr(self, name)
            if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
                raise ValueError(f"{name} must be a finite number.")
        proportions = (
            "min_grounding_faithfulness",
            "max_unsupported_claim_rate",
            "min_concept_coverage",
            "min_atomicity_score",
            "min_answer_specificity",
            "max_duplicate_rate",
            "min_provenance_accuracy",
            "min_schema_validity",
            "min_quality_gate_acceptance_rate",
            "min_human_acceptance_rate",
            "max_human_edit_rate",
            "max_provider_failure_rate",
        )
        for name in proportions:
            value = getattr(self, name)
            if not 0 <= value <= 1:
                raise ValueError(f"{name} must be between zero and one.")
        if self.max_latency_p95_ms <= 0:
            raise ValueError("max_latency_p95_ms must be positive.")
        if self.max_estimated_cost < 0:
            raise ValueError("max_estimated_cost must be non-negative.")
        for name in ("max_latency_regression_ratio", "max_cost_regression_ratio"):
            if getattr(self, name) < 1:
                raise ValueError(f"{name} must be at least one.")

def reproducible_split(dataset_id: str, item_ids: list[str], seed: str, ratios=(0.6, 0.2, 0.2)) -> DatasetSplit:
    if len(set(item_ids)) != len(item_ids): raise ValueError("Dataset item IDs must be unique.")
    if not math.isclose(sum(ratios), 1.0): raise ValueError("Split ratios must sum to one.")
    ordered = sorted(item_ids, key=lambda x: hashlib.sha256(f"{seed}\0{x}".encode()).hexdigest())
    groups = [[], [], []]
    for item in ordered:
        unit = int(hashlib.sha256(f"{seed}\0bucket\0{item}".encode()).hexdigest()[:8], 16) / 0xffffffff
        groups[0 if unit < ratios[0] else 1 if unit < ratios[0] + ratios[1] else 2].append(item)
    for target in groups:
        if not target and len(item_ids) >= 3: target.append(max(groups, key=len).pop())
    return DatasetSplit(dataset_id, SPLIT_VERSION, seed, *(tuple(sorted(x)) for x in groups))

def validate_split(split: DatasetSplit) -> None:
    groups = [set(split.development), set(split.validation), set(split.holdout)]
    if groups[0] & groups[1] or groups[0] & groups[2] or groups[1] & groups[2]: raise ValueError("Dataset splits overlap.")
    if not all(groups): raise ValueError("Development, validation, and holdout must be non-empty.")

def anonymize_candidates(left: dict[str, Any], right: dict[str, Any], seed: str):
    values = (right, left) if int(sha256_text(seed)[:2], 16) % 2 else (left, right)
    public = {"candidateA": _without_identity(values[0]), "candidateB": _without_identity(values[1])}
    key = {"candidateA": values[0].get("identity", ""), "candidateB": values[1].get("identity", "")}
    return public, key

def same_family_warning(generator_family: str, evaluator_family: str) -> str:
    return "Evaluator-generator family overlap: qualitative scores are not independent evidence." if generator_family.strip().lower() == evaluator_family.strip().lower() else ""

def quality_metrics(cards, coverage, dispositions, verification_statuses=None):
    total = max(1, len(cards)); counts = {x: sum(y == x for y in dispositions.values()) for x in ("PUBLISH", "SANITIZE", "REVIEW", "REJECT")}
    qtypes = {}
    for card in cards: qtypes[str(card.get("cardType") or "unspecified")] = qtypes.get(str(card.get("cardType") or "unspecified"), 0) + 1
    rows = coverage.get("coverageMap", {}).get("sections", {})
    return {"cardCount": len(cards), "sourceCoverage": coverage.get("sourceCoverage", 0),
        "importantConceptCoverage": coverage.get("importantConceptCoverage", 0), "criticalConceptCoverage": coverage.get("criticalConceptCoverage", 0),
        "eligibleSectionCoverage": round(sum(x.get("coveredConceptCount", 0)>0 for x in rows.values())/len(rows),4) if rows else 0,
        "sourcePositionDistribution": coverage.get("sourcePositionDistribution", {}), "duplicateRate": coverage.get("duplicateRate",0),
        "conceptDiversity": coverage.get("conceptDiversity",0), "coverageBalance": coverage.get("coverageBalance",0),
        "questionTypeDistribution": qtypes, "difficultyDistribution": {"unmeasured": len(cards)},
        "unsupportedClaimRate": None, "hallucinationRate": None,
        "sourceConflictRate": round(sum(x=="conflict" for x in (verification_statuses or []))/max(1,len(verification_statuses or [])),4),
        "medicalSafetyFailureRate": 0.0 if counts["PUBLISH"] == 0 else None,
        **{f"{x.lower()}Rate": round(counts[x]/total,4) for x in counts},
        "atomicity": None, "conciseness": None, "activeRecallQuality": None, "educationalValue": None, "studyEfficiency": None}


def cost_metrics(usage, accepted_cards, covered_important, requests, latency_ms=None):
    input_tokens, output_tokens = int(usage.get("inputTokens") or 0), int(usage.get("outputTokens") or 0)
    return {"currencyCost": None, "costPerAcceptedCard": None, "costPerCoveredImportantConcept": None,
        "tokensPerAcceptedCard": round((input_tokens+output_tokens)/accepted_cards,2) if accepted_cards else None,
        "requestsPerCompletedDeck": requests, "latencyPerAcceptedCardMs": round(latency_ms/accepted_cards,2) if latency_ms is not None and accepted_cards else None,
        "inputTokens": input_tokens, "outputTokens": output_tokens, "verificationCost": 0,
        "evaluationCost": None, "providerFailureRate": None}


def evaluation_run_record(*, model, model_version, prompt_version, dataset_version,
                          schema_version, configuration, code_commit, quality, cost,
                          latency_samples_ms=None, reliability=None, created_at=None):
    samples = sorted(int(value) for value in (latency_samples_ms or []))
    reliability = reliability or {}
    metrics = {
        "groundingFaithfulness": quality.get("groundingFaithfulness"),
        "unsupportedClaimRate": quality.get("unsupportedClaimRate"),
        "conceptCoverage": quality.get("sourceCoverage"),
        "atomicityScore": quality.get("atomicity"),
        "answerSpecificity": quality.get("answerSpecificity"),
        "duplicateRate": quality.get("duplicateRate"),
        "provenanceAccuracy": quality.get("provenanceAccuracy"),
        "schemaValidity": reliability.get("schemaValidity"),
        "qualityGateAcceptanceRate": quality.get("publishRate"),
        "humanAcceptanceRate": quality.get("humanAcceptanceRate"),
        "humanEditRate": quality.get("humanEditRate"),
        "latencyP50": _percentile(samples, .50),
        "latencyP95": _percentile(samples, .95),
        "inputTokens": cost.get("inputTokens"),
        "outputTokens": cost.get("outputTokens"),
        "estimatedCost": cost.get("currencyCost"),
        "providerFailureRate": reliability.get("providerFailureRate"),
    }
    if not model or not model_version or not prompt_version or not dataset_version or not schema_version:
        raise ValueError("Evaluation run identity must be complete.")
    if not isinstance(configuration, dict):
        raise ValueError("Evaluation run configuration must be an object.")
    if not re.fullmatch(r"[a-f0-9]{7,64}", code_commit):
        raise ValueError("Evaluation run requires a commit SHA.")
    record = {
        "evaluationRunVersion": EVALUATION_RUN_VERSION,
        "identity": {
            "model": model,
            "modelVersion": model_version,
            "promptVersion": prompt_version,
            "datasetVersion": dataset_version,
            "schemaVersion": schema_version,
            "configuration": configuration,
            "date": created_at or datetime.now(timezone.utc).isoformat(),
            "commitSha": code_commit,
        },
        "metrics": metrics,
    }
    validate_evaluation_run_record(record)
    return record


def validate_evaluation_run_record(payload: Any) -> None:
    if not isinstance(payload, dict):
        raise ValueError("Evaluation run must be a JSON object.")
    if payload.get("evaluationRunVersion") != EVALUATION_RUN_VERSION:
        raise ValueError(f"Evaluation run version must be {EVALUATION_RUN_VERSION}.")
    identity = payload.get("identity")
    if not isinstance(identity, dict):
        raise ValueError("Evaluation run requires identity metadata.")
    if not isinstance(payload.get("metrics"), dict):
        raise ValueError("Evaluation run requires metrics.")
    for field in ("model", "modelVersion", "promptVersion", "datasetVersion", "schemaVersion", "date", "commitSha"):
        if not isinstance(identity.get(field), str) or not identity[field].strip():
            raise ValueError(f"Evaluation run identity requires {field}.")
    if not isinstance(identity.get("configuration"), dict):
        raise ValueError("Evaluation run identity requires configuration object.")
    if not re.fullmatch(r"[a-f0-9]{7,64}", identity["commitSha"]):
        raise ValueError("Evaluation run requires a commit SHA.")


def _percentile(values, fraction):
    if not values:
        return None
    index = max(0, math.ceil(len(values) * fraction) - 1)
    return values[index]


def model_promotion_decision(
    baseline: dict[str, Any],
    candidate: dict[str, Any],
    thresholds: ModelPromotionThresholds,
) -> dict[str, Any]:
    required_metrics = (
        "groundingFaithfulness",
        "unsupportedClaimRate",
        "conceptCoverage",
        "atomicityScore",
        "answerSpecificity",
        "duplicateRate",
        "provenanceAccuracy",
        "schemaValidity",
        "qualityGateAcceptanceRate",
        "humanAcceptanceRate",
        "humanEditRate",
        "latencyP95",
        "estimatedCost",
        "providerFailureRate",
    )
    missing = [
        {"code": "METRIC_MISSING", "metric": metric, "side": side}
        for side, metrics in (("baseline", baseline), ("candidate", candidate))
        for metric in required_metrics
        if _metric_number(metrics.get(metric)) is None
    ]
    result = {
        "promotionGateVersion": PROMOTION_GATE_VERSION,
        "decision": "INCONCLUSIVE" if missing else "PROMOTE",
        "thresholds": _promotion_threshold_payload(thresholds),
        "failures": missing,
    }
    if missing:
        return result

    failures: list[dict[str, Any]] = []
    minimums = {
        "groundingFaithfulness": thresholds.min_grounding_faithfulness,
        "conceptCoverage": thresholds.min_concept_coverage,
        "atomicityScore": thresholds.min_atomicity_score,
        "answerSpecificity": thresholds.min_answer_specificity,
        "provenanceAccuracy": thresholds.min_provenance_accuracy,
        "schemaValidity": thresholds.min_schema_validity,
        "qualityGateAcceptanceRate": thresholds.min_quality_gate_acceptance_rate,
        "humanAcceptanceRate": thresholds.min_human_acceptance_rate,
    }
    maximums = {
        "unsupportedClaimRate": thresholds.max_unsupported_claim_rate,
        "duplicateRate": thresholds.max_duplicate_rate,
        "humanEditRate": thresholds.max_human_edit_rate,
        "latencyP95": thresholds.max_latency_p95_ms,
        "estimatedCost": thresholds.max_estimated_cost,
        "providerFailureRate": thresholds.max_provider_failure_rate,
    }
    for metric, required in minimums.items():
        value = candidate[metric]
        if value < required:
            failures.append(_threshold_failure(metric, value, ">=", required))
    for metric, required in maximums.items():
        value = candidate[metric]
        if value > required:
            failures.append(_threshold_failure(metric, value, "<=", required))

    higher_is_better = (
        "groundingFaithfulness",
        "conceptCoverage",
        "atomicityScore",
        "answerSpecificity",
        "provenanceAccuracy",
        "schemaValidity",
        "qualityGateAcceptanceRate",
        "humanAcceptanceRate",
    )
    lower_is_better = (
        "unsupportedClaimRate",
        "duplicateRate",
        "humanEditRate",
        "providerFailureRate",
    )
    for metric in higher_is_better:
        if candidate[metric] < baseline[metric]:
            failures.append(_regression_failure(metric, baseline[metric], candidate[metric]))
    for metric in lower_is_better:
        if candidate[metric] > baseline[metric]:
            failures.append(_regression_failure(metric, baseline[metric], candidate[metric]))

    if candidate["latencyP95"] > baseline["latencyP95"] * thresholds.max_latency_regression_ratio:
        failures.append(_regression_failure("latencyP95", baseline["latencyP95"], candidate["latencyP95"]))
    if candidate["estimatedCost"] > baseline["estimatedCost"] * thresholds.max_cost_regression_ratio:
        failures.append(_regression_failure("estimatedCost", baseline["estimatedCost"], candidate["estimatedCost"]))

    result["decision"] = "REJECT" if failures else "PROMOTE"
    result["failures"] = failures
    return result


def _metric_number(value: Any) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    number = float(value)
    return number if math.isfinite(number) else None


def _threshold_failure(metric: str, candidate: float, operator: str, required: float) -> dict[str, Any]:
    return {
        "code": "THRESHOLD_NOT_MET",
        "metric": metric,
        "candidate": candidate,
        "operator": operator,
        "required": required,
    }


def _regression_failure(metric: str, baseline: float, candidate: float) -> dict[str, Any]:
    return {"code": "REGRESSION", "metric": metric, "baseline": baseline, "candidate": candidate}


def _promotion_threshold_payload(thresholds: ModelPromotionThresholds) -> dict[str, float]:
    return {
        "minGroundingFaithfulness": thresholds.min_grounding_faithfulness,
        "maxUnsupportedClaimRate": thresholds.max_unsupported_claim_rate,
        "minConceptCoverage": thresholds.min_concept_coverage,
        "minAtomicityScore": thresholds.min_atomicity_score,
        "minAnswerSpecificity": thresholds.min_answer_specificity,
        "maxDuplicateRate": thresholds.max_duplicate_rate,
        "minProvenanceAccuracy": thresholds.min_provenance_accuracy,
        "minSchemaValidity": thresholds.min_schema_validity,
        "minQualityGateAcceptanceRate": thresholds.min_quality_gate_acceptance_rate,
        "minHumanAcceptanceRate": thresholds.min_human_acceptance_rate,
        "maxHumanEditRate": thresholds.max_human_edit_rate,
        "maxLatencyP95Ms": thresholds.max_latency_p95_ms,
        "maxLatencyRegressionRatio": thresholds.max_latency_regression_ratio,
        "maxEstimatedCost": thresholds.max_estimated_cost,
        "maxCostRegressionRatio": thresholds.max_cost_regression_ratio,
        "maxProviderFailureRate": thresholds.max_provider_failure_rate,
    }

def decide_experiment(*, safety_delta, grounding_delta, critical_coverage_delta, citation_delta,
                      validation_improved, holdout_regression, cost_acceptable):
    failures = []
    if safety_delta < 0: failures.append("safety regression")
    if grounding_delta < 0: failures.append("grounding regression")
    if critical_coverage_delta < 0: failures.append("critical coverage regression")
    if citation_delta < 0: failures.append("citation regression")
    if not validation_improved: failures.append("validation did not support improvement")
    if holdout_regression: failures.append("holdout regression")
    if not cost_acceptable: failures.append("cost or latency unacceptable")
    return ("REJECT", "; ".join(failures)) if failures else ("ACCEPT", "Improved without safety, grounding, coverage, citation, holdout, or cost regression.")

def evidence_linked_recommendation(root_cause, finding, intervention, evidence):
    if root_cause not in ROOT_CAUSES or not finding or not intervention or not evidence:
        raise ValueError("Recommendation requires root cause, finding, intervention, and evidence.")
    return {"rootCause": root_cause, "finding": finding, "recommendedIntervention": intervention, "evidence": evidence}

def baseline_id(payload):
    return f"baseline-{sha256_text(canonical_json(payload))[:20]}"

def _without_identity(value):
    return {key: item for key, item in value.items() if key not in {"identity", "model", "provider", "product"}}
