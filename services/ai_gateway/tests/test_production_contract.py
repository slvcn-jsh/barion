import json
import importlib
from pathlib import Path

from services.ai_gateway.models import GeneratedCard


def test_shared_production_evaluation_contract_is_valid_python_gateway_payload():
    fixture = Path(__file__).parents[2] / "card_evaluation" / "fixtures" / "production_contract_case.json"
    payload = json.loads(fixture.read_text(encoding="utf-8"))
    candidate = GeneratedCard.model_validate(payload["candidate"])
    assert candidate.evaluation is not None
    assert candidate.evaluation.publicationDisposition == "PUBLISH"
    assert candidate.evaluation.claimResults[0].sourceSupport == "supported_by_citation"


def test_production_evaluation_runtime_modules_are_importable():
    for module in (
        "services.card_evaluation.pipeline",
        "services.card_evaluation.claims",
        "services.card_evaluation.grounding",
        "services.card_evaluation.normalization",
        "services.card_evaluation.text",
        "services.card_evaluation.validation",
    ):
        assert importlib.import_module(module)
