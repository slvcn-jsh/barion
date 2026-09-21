from __future__ import annotations

import csv
import math
import random
from collections import Counter, defaultdict
from pathlib import Path

from .analysis import core_answer
from .io_utils import read_json, sha256_text
from .models import Card, Concept

BLIND_REVIEW_VERSION = "1.0.0"
RUBRIC_VERSION = "1.0.0"
MIN_COMPARATIVE_PAIRS = 30
MIN_REVIEWERS = 2
MIN_PREFERENCE_AGREEMENT = 0.70
MIN_PREFERENCE_KAPPA = 0.40
_SCORE_FIELDS = ("accuracy", "clarity", "learningValue")


def build_blind_review(matches: list[dict[str, object]], production: list[Card], quizlet: list[Card],
                       concepts: list[Concept], seed: str, limit: int) -> tuple[list[dict[str, object]], list[dict[str, object]]]:
    cards = {card.cardId: card for card in production + quizlet}
    concept_map = {concept.conceptId: concept for concept in concepts}
    selected = list(matches)
    random.Random(seed).shuffle(selected)
    selected = selected[:limit]
    rows: list[dict[str, object]] = []; key: list[dict[str, object]] = []
    rng = random.Random(f"{seed}:orientation")
    for index, match in enumerate(selected, 1):
        production_card = cards[str(match["productionCardId"])]
        quizlet_card = cards[str(match["quizletCardId"])]
        left, right = ((production_card, quizlet_card) if rng.randrange(2) == 0
                       else (quizlet_card, production_card))
        pair_id = f"pair-{index:03d}"; concept = concept_map[str(match["conceptId"])]
        rows.append({
            "pairId": pair_id, "sourceLocator": concept.locator,
            "sourceProposition": concept.atomicProposition,
            "cardAQuestion": left.question, "cardAAnswer": core_answer(left.answer),
            "cardBQuestion": right.question, "cardBAnswer": core_answer(right.answer),
            "reviewerId": "", "accuracyA": "", "accuracyB": "", "clarityA": "", "clarityB": "",
            "learningValueA": "", "learningValueB": "", "preference": "", "exclusionReason": "", "notes": "",
        })
        key.append({"pairId": pair_id, "conceptId": concept.conceptId,
                    "cardAId": left.cardId, "systemA": left.system,
                    "cardBId": right.cardId, "systemB": right.system})
    return rows, key


def review_protocol(pair_count: int) -> dict[str, object]:
    return {
        "blindReviewVersion": BLIND_REVIEW_VERSION, "rubricVersion": RUBRIC_VERSION,
        "instructions": [
            "Each reviewer copies blind_review.csv and works independently without opening private/blind_review_key.json.",
            "Score each card against source proposition: accuracy, clarity, and learning value from 1 (poor) to 5 (excellent).",
            "Choose preference A, B, or TIE. Use exclusionReason only when source extraction prevents fair judgment.",
            "Do not infer system identity from formatting or coordinate scores before submission.",
        ],
        "scoreAnchors": {"1": "materially wrong or unusable", "2": "major weakness", "3": "adequate",
                         "4": "strong", "5": "excellent"},
        "pairCount": pair_count,
        "acceptanceGates": {
            "minimumPairs": MIN_COMPARATIVE_PAIRS, "minimumReviewers": MIN_REVIEWERS,
            "minimumPreferenceAgreement": MIN_PREFERENCE_AGREEMENT,
            "minimumPreferenceKappa": MIN_PREFERENCE_KAPPA, "minimumSystemAccuracyMean": 4.0,
            "superiorityRule": "95% paired bootstrap CI lower bound for overall score delta must exceed 0",
            "safetyRule": "No source contradictions or critical publication failures in production deck",
        },
    }



def _validate_review_row(row: dict[str, str], path: Path) -> None:
    for field in _SCORE_FIELDS:
        for side in ("A", "B"):
            try:
                value = int(row[f"{field}{side}"])
            except (KeyError, ValueError) as error:
                raise ValueError(f"{path}: {field}{side} must be an integer 1-5.") from error
            if value not in range(1, 6):
                raise ValueError(f"{path}: {field}{side} must be an integer 1-5.")
    if row.get("preference", "").strip().upper() not in {"A", "B", "TIE"}:
        raise ValueError(f"{path}: preference must be A, B, or TIE.")


def _agreement(preferences: dict[str, list[str]]) -> tuple[float, float]:
    pairs = [(values[left], values[right]) for values in preferences.values()
             for left in range(len(values)) for right in range(left + 1, len(values))]
    if not pairs:
        return 0.0, 0.0
    observed = sum(left == right for left, right in pairs) / len(pairs)
    left_counts = Counter(left for left, _ in pairs); right_counts = Counter(right for _, right in pairs)
    expected = sum((left_counts[label] / len(pairs)) * (right_counts[label] / len(pairs))
                   for label in set(left_counts) | set(right_counts))
    kappa = (observed - expected) / (1 - expected) if expected < 1 else (1.0 if observed == 1 else 0.0)
    return observed, kappa


def _bootstrap_ci(values: list[float], iterations: int = 2000) -> tuple[float, float]:
    if not values:
        return 0.0, 0.0
    rng = random.Random(sha256_text("|".join(f"{value:.8f}" for value in values)))
    means = sorted(_mean([values[rng.randrange(len(values))] for _ in values]) for _ in range(iterations))
    return means[int(iterations * 0.025)], means[min(iterations - 1, int(iterations * 0.975))]


def _mean(values: list[float]) -> float:
    return math.fsum(values) / len(values) if values else 0.0



def score_review_files(run_dir: Path, review_paths: list[Path]) -> dict[str, object]:
    key = read_json(run_dir / "private" / "blind_review_key.json")
    protocol = read_json(run_dir / "blind_review_protocol.json")
    metrics = read_json(run_dir / "metrics.json"); manifest = read_json(run_dir / "manifest.json")
    versions = manifest.get("versions", {})
    if versions.get("blindReview") != BLIND_REVIEW_VERSION or versions.get("rubric") != RUBRIC_VERSION:
        raise ValueError("Run uses incompatible blind-review or rubric version.")
    if protocol.get("blindReviewVersion") != BLIND_REVIEW_VERSION or protocol.get("rubricVersion") != RUBRIC_VERSION:
        raise ValueError("Blind-review protocol version differs from scorer version.")
    pair_ids = {str(row["pairId"]) for row in key}; key_map = {str(row["pairId"]): row for row in key}
    reviewers: dict[str, dict[str, dict[str, str]]] = {}
    for path in review_paths:
        with path.open(encoding="utf-8-sig", newline="") as handle:
            rows = list(csv.DictReader(handle))
        reviewer_ids = {row.get("reviewerId", "").strip() for row in rows if row.get("reviewerId", "").strip()}
        if len(reviewer_ids) != 1:
            raise ValueError(f"{path} must contain exactly one non-empty reviewerId.")
        reviewer = next(iter(reviewer_ids))
        if reviewer in reviewers:
            raise ValueError(f"Duplicate reviewerId: {reviewer}.")
        included = {row.get("pairId", ""): row for row in rows if not row.get("exclusionReason", "").strip()}
        if set(included) != pair_ids:
            raise ValueError(f"{path} must score every pair without exclusions before comparative claims.")
        for row in included.values():
            _validate_review_row(row, path)
        reviewers[reviewer] = included

    system_scores: dict[str, dict[str, list[float]]] = defaultdict(lambda: defaultdict(list))
    pair_deltas: list[float] = []; preferences: dict[str, list[str]] = defaultdict(list)
    for pair_id in sorted(pair_ids):
        systems = key_map[pair_id]; per_reviewer_delta = []
        for rows in reviewers.values():
            row = rows[pair_id]; side_scores: dict[str, list[float]] = {"A": [], "B": []}
            for field in _SCORE_FIELDS:
                for side in ("A", "B"):
                    score = float(row[f"{field}{side}"]); side_scores[side].append(score)
                    system_scores[str(systems[f"system{side}"])][field].append(score)
            production_side = "A" if systems["systemA"] == "production" else "B"
            quizlet_side = "B" if production_side == "A" else "A"
            per_reviewer_delta.append(_mean(side_scores[production_side]) - _mean(side_scores[quizlet_side]))
            preference = row["preference"].strip().upper()
            preferences[pair_id].append("tie" if preference == "TIE" else str(systems[f"system{preference}"]))
        pair_deltas.append(_mean(per_reviewer_delta))

    agreement, kappa = _agreement(preferences); ci_low, ci_high = _bootstrap_ci(pair_deltas)
    means = {system: {field: round(_mean(values), 4) for field, values in fields.items()}
             for system, fields in sorted(system_scores.items())}
    preference_counts = Counter(value for values in preferences.values() for value in values)
    evaluation = metrics.get("phase1Evaluation", {})
    gates = {
        "productionQuantityContract": bool(manifest.get("generation", {}).get("quantityContractMet")),
        "minimumPairs": len(pair_ids) >= MIN_COMPARATIVE_PAIRS,
        "minimumReviewers": len(reviewers) >= MIN_REVIEWERS,
        "preferenceAgreement": agreement >= MIN_PREFERENCE_AGREEMENT,
        "preferenceKappa": kappa >= MIN_PREFERENCE_KAPPA,
        "productionAccuracy": means.get("production", {}).get("accuracy", 0.0) >= 4.0,
        "productionSafety": evaluation.get("contradictions", 0) == 0 and evaluation.get("criticalFailures", 0) == 0,
        "productionSuperiority": ci_low > 0.0,
    }
    validity_names = ("productionQuantityContract", "minimumPairs", "minimumReviewers",
                      "preferenceAgreement", "preferenceKappa", "productionSafety")
    valid = all(gates[name] for name in validity_names)
    return {
        "blindReviewVersion": BLIND_REVIEW_VERSION, "rubricVersion": RUBRIC_VERSION,
        "pairCount": len(pair_ids), "reviewerCount": len(reviewers), "reviewerIds": sorted(reviewers),
        "systemMeans": means, "preferenceCounts": dict(sorted(preference_counts.items())),
        "preferenceAgreement": round(agreement, 4), "preferenceKappa": round(kappa, 4),
        "productionOverallDelta": round(_mean(pair_deltas), 4),
        "productionOverallDelta95Ci": [round(ci_low, 4), round(ci_high, 4)],
        "gates": gates, "comparativeConclusionAllowed": valid,
        "productionSuperior": valid and gates["productionAccuracy"] and gates["productionSuperiority"],
        "status": "PASS" if all(gates.values()) else "BLOCKED",
    }
