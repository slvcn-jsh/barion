from __future__ import annotations
import hashlib, math
from dataclasses import dataclass
from typing import Any
from .io_utils import canonical_json, sha256_text

OPTIMIZATION_VERSION = "1.0.0"
SPLIT_VERSION = "1.0.0"
EXPERIMENT_VERSION = "1.0.0"
QUALITY_GATE_VERSION = "1.0.0"
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
