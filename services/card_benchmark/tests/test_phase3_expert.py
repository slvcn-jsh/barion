import json

import pytest

from services.card_benchmark.expert_evaluation import (
    DIMENSIONS,
    ExpertEvaluation,
    classify_quality,
    comparison_statistics,
    parse_evaluation,
    resolve_verification,
    verification_reasons,
)


def scores(value=3):
    return {dimension: value for dimension in DIMENSIONS}


def test_quality_rubric_schema_bounds_nulls_and_classification():
    evaluation = ExpertEvaluation("c1", {**scores(4), "clinicalRelevance": None}, "EXCELLENT", 0.9, "Strong.")
    assert evaluation.scores["clinicalRelevance"] is None
    assert classify_quality(scores(4)) == "EXCELLENT"
    assert classify_quality(scores(3)) == "GOOD"
    assert classify_quality(scores(2)) == "USABLE_WITH_REPAIR"
    assert classify_quality(scores(1)) == "POOR"
    assert classify_quality(scores(0)) == "UNUSABLE"
    with pytest.raises(ValueError):
        ExpertEvaluation("c1", {**scores(), "clarity": 5}, "GOOD", 0.9, "Invalid.")


def test_sol_json_parsing_and_malformed_result():
    payload = {"cardId": "c1", "scores": scores(), "quality": "GOOD", "confidence": 0.8, "reason": "Clear."}
    assert parse_evaluation(json.dumps(payload)).cardId == "c1"
    with pytest.raises(ValueError):
        parse_evaluation("not json")
    with pytest.raises(ValueError):
        parse_evaluation(json.dumps({"cardId": "c1"}))


def test_verification_triggers_revision_and_persistent_uncertainty():
    assert "LOW_CONFIDENCE" in verification_reasons(0.6, 3, 1, "A_BETTER", "HIGH", False, False)
    assert "CLOSE_SCORE" in verification_reasons(0.9, 3.0, 2.8, "A_BETTER", "HIGH", False, False)
    assert "MEDIUM_MATCH" in verification_reasons(0.9, 4, 2, "A_BETTER", "MEDIUM", False, False)
    assert resolve_verification("A_BETTER", "B_BETTER") == ("UNCERTAIN", "STILL_UNCERTAIN")
    assert resolve_verification("A_BETTER", "ROUGHLY_EQUIVALENT") == ("ROUGHLY_EQUIVALENT", "REVISED")
    assert resolve_verification("A_BETTER", "A_BETTER") == ("A_BETTER", "CONFIRMED")


def test_statistics_and_bootstrap_are_reproducible():
    rows = [
        {"finalOutcome": "A_BETTER", "systemA": "production", "verified": True, "verificationState": "CONFIRMED", "dimensionDeltas": {"clarity": 1}},
        {"finalOutcome": "ROUGHLY_EQUIVALENT", "systemA": "quizlet", "verified": True, "verificationState": "REVISED", "dimensionDeltas": {"clarity": 0}},
    ]
    assert comparison_statistics(rows, seed="fixed") == comparison_statistics(rows, seed="fixed")
    result = comparison_statistics(rows, seed="fixed")
    assert result["preferenceCounts"]["production"] == 1
    assert result["solSelfConsistencyRate"] == 0.5
