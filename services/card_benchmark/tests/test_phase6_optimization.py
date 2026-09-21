import pytest
from services.card_benchmark.optimization import (
    Experiment, anonymize_candidates, cost_metrics, decide_experiment,
    evidence_linked_recommendation, reproducible_split, same_family_warning, validate_split,
)

def test_split_reproducible_complete_and_disjoint():
    ids = [f"item-{index}" for index in range(50)]
    first = reproducible_split("dataset", ids, "seed")
    second = reproducible_split("dataset", list(reversed(ids)), "seed")
    assert first == second
    validate_split(first)
    assert set(first.development) | set(first.validation) | set(first.holdout) == set(ids)

def test_split_rejects_duplicates_and_overlap():
    with pytest.raises(ValueError): reproducible_split("d", ["x", "x", "y"], "s")

def test_experiment_requires_one_intervention_and_known_root_cause():
    values = dict(experimentId="x", hypothesis="h", rootCause="CITATION", singleIntervention={"sourceSpanResolver": "1.0.0"},
                  baselineRun="b", candidateRun="c", developmentResult={}, validationResult={}, holdoutResult={},
                  safetyDelta=0, groundingDelta=0, coverageDelta=0, pedagogyDelta=0, costDelta=0, latencyDelta=0,
                  decision="ACCEPT", reason="evidence")
    assert Experiment(**values).rootCause == "CITATION"
    with pytest.raises(ValueError): Experiment(**{**values, "singleIntervention": {"prompt": "2", "model": "x"}})

def test_anonymization_hides_model_identity_and_warns_same_family():
    public, key = anonymize_candidates({"identity": "gemini", "question": "A"}, {"identity": "openai", "question": "B"}, "seed")
    assert "identity" not in public["candidateA"] and set(key.values()) == {"gemini", "openai"}
    assert same_family_warning("openai", "OpenAI")
    assert not same_family_warning("anthropic", "openai")

def test_cost_metrics_are_denominator_safe():
    empty = cost_metrics({"inputTokens": 10, "outputTokens": 5}, 0, 0, 2)
    assert empty["tokensPerAcceptedCard"] is None and empty["currencyCost"] is None
    assert cost_metrics({"inputTokens": 10, "outputTokens": 10}, 2, 1, 1)["tokensPerAcceptedCard"] == 10

def test_acceptance_policy_rejects_safety_or_holdout_regression():
    accepted = decide_experiment(safety_delta=0, grounding_delta=0, critical_coverage_delta=0, citation_delta=1,
                                 validation_improved=True, holdout_regression=False, cost_acceptable=True)
    assert accepted[0] == "ACCEPT"
    rejected = decide_experiment(safety_delta=-0.01, grounding_delta=0, critical_coverage_delta=0, citation_delta=1,
                                 validation_improved=True, holdout_regression=True, cost_acceptable=True)
    assert rejected[0] == "REJECT" and "safety" in rejected[1]

def test_recommendation_requires_evidence_link():
    result = evidence_linked_recommendation("CITATION", "50 legacy spans", "deterministic resolver", {"resolved": 50})
    assert result["evidence"]["resolved"] == 50
    with pytest.raises(ValueError): evidence_linked_recommendation("CITATION", "finding", "fix", {})
