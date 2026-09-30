from dataclasses import replace

import pytest
from services.card_benchmark.optimization import (
    Experiment, ModelPromotionThresholds, anonymize_candidates, cost_metrics,
    decide_experiment, evaluation_run_record, evidence_linked_recommendation,
    model_promotion_decision, reproducible_split, same_family_warning, validate_split,
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


def test_evaluation_run_records_frozen_identity_and_complete_metric_contract():
    record = evaluation_run_record(
        model="gemini-3.8-flash/base",
        model_version="gemini-3.8-flash",
        prompt_version="bari-cardgen-v1",
        dataset_version="bari-cardgen-test-v1",
        schema_version="gateway-card-schema-1.2.0",
        configuration={"thinkingLevel": "low", "temperature": 0.2},
        code_commit="a" * 40,
        quality={"sourceCoverage": 0.8, "duplicateRate": 0.02, "publishRate": 0.7},
        cost={"inputTokens": 100, "outputTokens": 50, "currencyCost": None},
        latency_samples_ms=[100, 200, 400],
        reliability={"providerFailureRate": 0.01, "schemaValidity": 0.99},
    )
    assert record["identity"]["datasetVersion"] == "bari-cardgen-test-v1"
    assert record["metrics"]["latencyP50"] == 200
    assert record["metrics"]["latencyP95"] == 400
    assert record["metrics"]["estimatedCost"] is None
    assert {
        "groundingFaithfulness", "unsupportedClaimRate", "conceptCoverage", "atomicityScore",
        "answerSpecificity", "duplicateRate", "provenanceAccuracy", "schemaValidity",
        "qualityGateAcceptanceRate", "humanAcceptanceRate", "humanEditRate", "providerFailureRate",
    } <= set(record["metrics"])


def _promotion_thresholds():
    return ModelPromotionThresholds(
        min_grounding_faithfulness=.98,
        max_unsupported_claim_rate=.01,
        min_concept_coverage=.75,
        min_atomicity_score=.8,
        min_answer_specificity=.8,
        max_duplicate_rate=.05,
        min_provenance_accuracy=.98,
        min_schema_validity=.99,
        min_quality_gate_acceptance_rate=.7,
        min_human_acceptance_rate=.75,
        max_human_edit_rate=.2,
        max_latency_p95_ms=30_000,
        max_latency_regression_ratio=1.25,
        max_estimated_cost=2.0,
        max_cost_regression_ratio=1.25,
        max_provider_failure_rate=.02,
    )


def _promotion_metrics(**changes):
    values = {
        "groundingFaithfulness": .99,
        "unsupportedClaimRate": .01,
        "conceptCoverage": .8,
        "atomicityScore": .85,
        "answerSpecificity": .85,
        "duplicateRate": .03,
        "provenanceAccuracy": .99,
        "schemaValidity": 1.0,
        "qualityGateAcceptanceRate": .8,
        "humanAcceptanceRate": .8,
        "humanEditRate": .15,
        "latencyP95": 10_000,
        "estimatedCost": 1.0,
        "providerFailureRate": .01,
    }
    values.update(changes)
    return values


def test_model_promotion_is_inconclusive_when_required_evidence_is_missing():
    candidate = _promotion_metrics(humanAcceptanceRate=None, estimatedCost=None)

    result = model_promotion_decision(
        _promotion_metrics(),
        candidate,
        _promotion_thresholds(),
    )

    assert result["decision"] == "INCONCLUSIVE"
    assert result["promotionGateVersion"] == "1.0.0"
    assert {failure["metric"] for failure in result["failures"]} == {
        "estimatedCost",
        "humanAcceptanceRate",
    }
    assert all(failure["code"] == "METRIC_MISSING" for failure in result["failures"])


def test_model_promotion_rejects_quality_cost_and_reliability_regressions():
    candidate = _promotion_metrics(
        unsupportedClaimRate=.02,
        groundingFaithfulness=.97,
        estimatedCost=1.5,
        providerFailureRate=.03,
    )

    result = model_promotion_decision(
        _promotion_metrics(),
        candidate,
        _promotion_thresholds(),
    )

    assert result["decision"] == "REJECT"
    failure_codes = {(failure["code"], failure["metric"]) for failure in result["failures"]}
    assert ("THRESHOLD_NOT_MET", "unsupportedClaimRate") in failure_codes
    assert ("THRESHOLD_NOT_MET", "groundingFaithfulness") in failure_codes
    assert ("REGRESSION", "estimatedCost") in failure_codes
    assert ("THRESHOLD_NOT_MET", "providerFailureRate") in failure_codes


def test_model_promotion_passes_only_complete_non_regressing_candidate():
    baseline = _promotion_metrics(
        groundingFaithfulness=.98,
        conceptCoverage=.78,
        humanAcceptanceRate=.78,
        humanEditRate=.18,
        latencyP95=12_000,
        estimatedCost=1.1,
        providerFailureRate=.015,
    )
    candidate = _promotion_metrics()

    result = model_promotion_decision(baseline, candidate, _promotion_thresholds())

    assert result["decision"] == "PROMOTE"
    assert result["failures"] == []
    assert result["thresholds"]["minSchemaValidity"] == .99


def test_model_promotion_thresholds_reject_invalid_ranges():
    with pytest.raises(ValueError, match="max_latency_regression_ratio"):
        replace(_promotion_thresholds(), max_latency_regression_ratio=.9)


@pytest.mark.parametrize(
    "field,value",
    [
        ("max_latency_p95_ms", float("nan")),
        ("max_latency_p95_ms", float("inf")),
        ("max_latency_regression_ratio", float("nan")),
        ("max_estimated_cost", float("inf")),
        ("max_cost_regression_ratio", float("nan")),
    ],
)
def test_model_promotion_thresholds_reject_non_finite_values(field, value):
    with pytest.raises(ValueError, match="finite number"):
        replace(_promotion_thresholds(), **{field: value})


def test_evaluation_run_requires_physical_model_version_and_configuration_object():
    common = {
        "model": "gemini-3.8-flash/base",
        "prompt_version": "bari-cardgen-v1",
        "dataset_version": "bari-cardgen-test-v1",
        "schema_version": "gateway-card-schema-1.2.0",
        "code_commit": "a" * 40,
        "quality": {},
        "cost": {},
    }
    with pytest.raises(ValueError, match="identity must be complete"):
        evaluation_run_record(model_version="", configuration={}, **common)
    with pytest.raises(ValueError, match="configuration must be an object"):
        evaluation_run_record(model_version="gemini-3.8-flash", configuration=None, **common)
