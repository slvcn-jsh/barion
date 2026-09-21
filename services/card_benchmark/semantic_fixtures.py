from __future__ import annotations

from pathlib import Path

from .io_utils import read_json
from .models import Card, Concept
from .semantic_matching import SEMANTIC_MATCH_THRESHOLD, calibration_summary, score_concept_card

_FIXTURE = Path(__file__).with_name("fixtures") / "semantic_matching.json"


def run_semantic_fixtures(path: Path = _FIXTURE) -> tuple[dict[str, object], list[dict[str, object]]]:
    payload = read_json(path)
    rows: list[dict[str, object]] = []
    for raw in payload["cases"]:
        concept = Concept(
            conceptId=f"fixture-{raw['caseId']}", canonicalLabel=raw["label"],
            atomicProposition=raw["concept"], sourceSpans=(), section="fixture",
            aliases=tuple(raw["aliases"]), importance="medium", medicalRisk="none",
            conceptType="other", prerequisiteIds=(), extractionConfidence=1.0,
            importanceConfidence=1.0, inventoryReviewStatus="reviewed",
            inventoryVersion=str(payload["fixtureVersion"]),
        )
        card = Card(f"card-{raw['caseId']}", raw["question"], raw["answer"], "fixture")
        result = score_concept_card(concept, card)
        rows.append({"caseId": raw["caseId"], "expectedMatch": raw["expectedMatch"],
                     "actualMatch": result.score >= SEMANTIC_MATCH_THRESHOLD,
                     "score": result.score, "numericAgreement": result.numericAgreement,
                     "contradictionVeto": result.contradictionVeto})
    summary = calibration_summary(rows)
    summary["fixtureVersion"] = payload["fixtureVersion"]
    return summary, rows
