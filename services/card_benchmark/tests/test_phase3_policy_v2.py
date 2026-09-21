from services.card_benchmark.expert_evaluation import ExpertEvaluation, DIMENSIONS
from services.card_benchmark.phase3_policy import final_disposition


def evaluation(quality="GOOD"):
    return ExpertEvaluation("c", {name: 3 for name in DIMENSIONS}, quality, 0.9, "Reason")


def test_unsupported_core_cannot_pass_because_pedagogy_is_good():
    assert final_disposition("REJECT", evaluation("EXCELLENT"), core_supported=False, safety_failure=False) == "REJECT"


def test_supported_card_publishes_and_optional_failure_sanitizes():
    assert final_disposition("PUBLISH", evaluation(), core_supported=True, safety_failure=False) == "PUBLISH"
    assert final_disposition("SANITIZE", evaluation(), core_supported=True, safety_failure=False) == "SANITIZE"


def test_poor_pedagogy_rejects_and_unresolved_high_risk_reviews():
    assert final_disposition("PUBLISH", evaluation("UNUSABLE"), core_supported=True, safety_failure=False) == "REJECT"
    assert final_disposition("REVIEW", evaluation(), core_supported=True, safety_failure=False, unresolved_high_risk=True) == "REVIEW"
