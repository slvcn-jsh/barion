from __future__ import annotations

from dataclasses import asdict
from pathlib import Path

from .io_utils import read_json
from .kernel import evaluate_card
from .models import Card, Segment
from .normalization import normalize_cards
from .validators import validate_deck

FIXTURE_VERSION = "1.0.0"
DEFAULT_FIXTURES = Path(__file__).resolve().parent / "fixtures" / "phase1_regressions.json"


def run_regression_fixtures(path: Path = DEFAULT_FIXTURES) -> tuple[dict[str, object], list[dict[str, object]]]:
    payload = read_json(path)
    if payload.get("fixtureVersion") != FIXTURE_VERSION:
        raise ValueError(f"Unsupported regression fixture version: {payload.get('fixtureVersion')!r}.")
    rows: list[dict[str, object]] = []
    for case in payload["cases"]:
        segments = [Segment(**segment) for segment in case["segments"]]
        if "cards" in case:
            deck_cards = [Card(**card) for card in case["cards"]]
            actual = {"validationCodes": sorted({item.code for item in validate_deck(normalize_cards(deck_cards), segments)})}
        else:
            evaluation = evaluate_card(Card(**case["card"]), segments)
            claims = evaluation["claims"]
            grounding = evaluation["grounding"]
            actual = {
                "decision": evaluation["policy"].decision,
                "sourceSupport": sorted({item.sourceSupport for item in grounding}),
                "citationStatus": sorted({item.citationStatus for item in grounding}),
                "claimTypes": sorted({claim.claimType for claim in claims}),
                "riskLevels": sorted({claim.riskLevel for claim in claims}),
                "numericValues": sorted({value.value for claim in claims for value in claim.numericValues}),
                "validationCodes": sorted({item.code for item in evaluation["validations"]}),
            }
        expected = case["expected"]
        failures = [f"{key}: expected {value!r}, got {actual.get(key)!r}" for key, value in expected.items() if actual.get(key) != value]
        rows.append({"caseId": case["caseId"], "passed": not failures, "failures": failures,
                     "expected": expected, "actual": actual})
    return {"fixtureVersion": FIXTURE_VERSION, "caseCount": len(rows),
            "passed": sum(bool(row["passed"]) for row in rows),
            "failed": sum(not bool(row["passed"]) for row in rows)}, rows
