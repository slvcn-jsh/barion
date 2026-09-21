from __future__ import annotations

import json
import math
import random
import re
from collections import Counter
from dataclasses import dataclass
from statistics import median

DIMENSIONS = (
    "questionClarity", "questionSpecificity", "answerability", "atomicity",
    "activeRecallQuality", "coreAnswerQuality", "conciseness", "cognitiveLoad",
    "educationalValue", "clinicalRelevance", "difficultyAppropriateness",
    "learningObjectiveAlignment", "cardTypeAppropriateness", "languageQuality",
    "studyEfficiency",
)
QUALITY_LABELS = {"EXCELLENT", "GOOD", "USABLE_WITH_REPAIR", "POOR", "UNUSABLE"}
OUTCOMES = {"A_BETTER", "B_BETTER", "ROUGHLY_EQUIVALENT", "MIXED", "UNCERTAIN", "NO_RELIABLE_COMPARISON"}
EXPERT_EVALUATOR_VERSION = "2.0.0"


@dataclass(frozen=True, slots=True)
class ExpertEvaluation:
    cardId: str
    scores: dict[str, int | None]
    quality: str
    confidence: float
    reason: str

    def __post_init__(self) -> None:
        if set(self.scores) != set(DIMENSIONS):
            raise ValueError("Evaluator scores must contain every rubric dimension exactly once.")
        if any(value is not None and (not isinstance(value, int) or not 0 <= value <= 4) for value in self.scores.values()):
            raise ValueError("Rubric scores must be integers from 0 to 4 or null.")
        if self.quality not in QUALITY_LABELS:
            raise ValueError("Unknown quality classification.")
        if not 0 <= self.confidence <= 1:
            raise ValueError("Confidence must be between 0 and 1.")
        if not self.reason.strip():
            raise ValueError("Evaluation reason is required.")


def parse_evaluation(raw: str | dict[str, object]) -> ExpertEvaluation:
    try:
        value = json.loads(raw) if isinstance(raw, str) else raw
        if not isinstance(value, dict):
            raise TypeError
        return ExpertEvaluation(
            cardId=str(value["cardId"]), scores=dict(value["scores"]), quality=str(value["quality"]),
            confidence=float(value["confidence"]), reason=str(value["reason"]),
        )
    except (KeyError, TypeError, ValueError, json.JSONDecodeError) as error:
        raise ValueError("Malformed SOL expert evaluator result.") from error


def classify_quality(scores: dict[str, int | None]) -> str:
    values = [value for value in scores.values() if value is not None]
    if not values or any(value == 0 for value in values): return "UNUSABLE"
    center = median(values)
    if center >= 4 and min(values) >= 3: return "EXCELLENT"
    if center >= 3 and min(values) >= 2: return "GOOD"
    if center >= 2: return "USABLE_WITH_REPAIR"
    return "POOR"


def verification_reasons(confidence: float, score_a: float, score_b: float, outcome: str,
                         match_confidence: str, safety_issue: bool, major_conclusion: bool) -> list[str]:
    reasons = []
    if confidence < 0.75: reasons.append("LOW_CONFIDENCE")
    if abs(score_a - score_b) <= 0.35: reasons.append("CLOSE_SCORE")
    if outcome in {"MIXED", "UNCERTAIN"}: reasons.append("NON_DECISIVE_OUTCOME")
    if match_confidence == "MEDIUM": reasons.append("MEDIUM_MATCH")
    if safety_issue: reasons.append("SAFETY_OR_PUBLICATION_ISSUE")
    if major_conclusion: reasons.append("MAJOR_CONCLUSION_SENSITIVITY")
    return reasons


def resolve_verification(first: str, second: str) -> tuple[str, str]:
    if first not in OUTCOMES or second not in OUTCOMES: raise ValueError("Unknown comparison outcome.")
    if first == second: return first, "CONFIRMED"
    if (first, second) in {("A_BETTER", "B_BETTER"), ("B_BETTER", "A_BETTER")} or "UNCERTAIN" in {first, second}:
        return "UNCERTAIN", "STILL_UNCERTAIN"
    return second, "REVISED"



_VAGUE = re.compile(r"^(?:discuss|tell me about|what should you know)\b", re.I)
_BUNDLES = re.compile(r"\b(?:and|versus| vs\.? |compare|differ)\b", re.I)


def evaluate_card_structured(card, source_evidence: str, *, core_supported: bool, safety_failure: bool = False) -> ExpertEvaluation:
    """Versioned local SOL rubric pass. Source/safety inputs remain authoritative gates."""
    question = card.question.strip(); answer = card.coreAnswer.strip()
    q_words, a_words = len(question.split()), len(answer.split())
    asks = question.count("?") + len(_BUNDLES.findall(question))
    scores: dict[str, int | None] = {
        "questionClarity": 3 if question.endswith("?") and not _VAGUE.search(question) else 2,
        "questionSpecificity": 3 if not _VAGUE.search(question) else 1,
        "answerability": 3 if core_supported else 0,
        "atomicity": 3 if asks <= 2 else (2 if asks <= 4 else 1),
        "activeRecallQuality": 3 if question.endswith("?") and len(set(question.lower().split()) & set(answer.lower().split())) < max(5, a_words // 2) else 2,
        "coreAnswerQuality": 3 if core_supported and answer else 0,
        "conciseness": 4 if a_words <= 20 else (3 if a_words <= 45 else (2 if a_words <= 80 else 1)),
        "cognitiveLoad": 3 if asks <= 2 and a_words <= 60 else (2 if asks <= 4 else 1),
        "educationalValue": 3 if source_evidence and answer else 1,
        "clinicalRelevance": 3 if re.search(r"patient|clinical|nurs|diagnos|treat|symptom|medication|disorder", f"{question} {answer}", re.I) else None,
        "difficultyAppropriateness": 3 if 5 <= q_words <= 40 else 2,
        "learningObjectiveAlignment": 3 if card.learningObjective else None,
        "cardTypeAppropriateness": 3 if card.cardType else None,
        "languageQuality": 3 if question.endswith("?") and answer else 1,
        "studyEfficiency": 3 if q_words <= 35 and a_words <= 60 else 2,
    }
    if safety_failure: scores["coreAnswerQuality"] = 0
    quality = classify_quality(scores)
    reason = "Structured rubric applied; source grounding and safety remain separate deterministic gates."
    return ExpertEvaluation(card.cardId, scores, quality, .82 if core_supported else .95, reason)



def comparison_statistics(rows: list[dict[str, object]], seed: str = "phase3-sol") -> dict[str, object]:
    deltas: dict[str, list[float]] = {dimension: [] for dimension in DIMENSIONS}
    preferences = Counter(); verified = agreements = revisions = uncertain = 0
    for row in rows:
        outcome, system_a = str(row["finalOutcome"]), str(row["systemA"])
        if outcome == "A_BETTER": preferences[system_a] += 1
        elif outcome == "B_BETTER": preferences["quizlet" if system_a == "production" else "production"] += 1
        elif outcome == "ROUGHLY_EQUIVALENT": preferences["tie"] += 1
        elif outcome == "MIXED": preferences["mixed"] += 1
        else: preferences["uncertain"] += 1; uncertain += 1
        if row.get("verified"):
            verified += 1
            agreements += row.get("verificationState") == "CONFIRMED"
            revisions += row.get("verificationState") == "REVISED"
        for name, value in dict(row.get("dimensionDeltas", {})).items():
            if name in deltas and value is not None: deltas[name].append(float(value))
    summaries = {}
    for name, values in deltas.items():
        if values:
            summaries[name] = {"mean": round(math.fsum(values) / len(values), 4),
                               "median": round(float(median(values)), 4),
                               "bootstrap95Ci": list(_bootstrap_ci(values, f"{seed}:{name}"))}
    return {
        "pairCount": len(rows), "preferenceCounts": dict(sorted(preferences.items())),
        "pairedDimensionDifferences": summaries, "verifiedPairCount": verified,
        "solSelfConsistencyRate": round(agreements / verified, 4) if verified else None,
        "firstPassVerificationAgreement": round(agreements / verified, 4) if verified else None,
        "revisionRate": round(revisions / verified, 4) if verified else None,
        "uncertaintyRate": round(uncertain / len(rows), 4) if rows else None,
        "independenceLimitation": "Verification is a same-model SOL self-consistency pass, not independent reviewer evidence.",
    }


def _bootstrap_ci(values: list[float], seed: str, iterations: int = 4000) -> tuple[float, float]:
    if not values: return 0.0, 0.0
    rng = random.Random(seed); estimates = []
    for _ in range(iterations):
        sample = [values[rng.randrange(len(values))] for _ in values]
        estimates.append(math.fsum(sample) / len(sample))
    estimates.sort()
    return round(estimates[int(.025 * (iterations - 1))], 4), round(estimates[int(.975 * (iterations - 1))], 4)
