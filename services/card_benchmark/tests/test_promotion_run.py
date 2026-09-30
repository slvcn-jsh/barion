import json

import pytest

from services.card_benchmark.promotion_run import run


def _metrics(**changes):
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


def _evaluation(model, metrics=None, dataset_version="dataset-v1"):
    return {
        "evaluationRunVersion": "1.0.0",
        "identity": {
            "model": model,
            "modelVersion": model,
            "promptVersion": "prompt-v1",
            "datasetVersion": dataset_version,
            "schemaVersion": "schema-v1",
            "configuration": {},
            "date": "2026-09-29T00:00:00Z",
            "commitSha": "a" * 40,
        },
        "metrics": metrics or _metrics(),
    }


def _thresholds():
    return {
        "minGroundingFaithfulness": .98,
        "maxUnsupportedClaimRate": .01,
        "minConceptCoverage": .75,
        "minAtomicityScore": .8,
        "minAnswerSpecificity": .8,
        "maxDuplicateRate": .05,
        "minProvenanceAccuracy": .98,
        "minSchemaValidity": .99,
        "minQualityGateAcceptanceRate": .7,
        "minHumanAcceptanceRate": .75,
        "maxHumanEditRate": .2,
        "maxLatencyP95Ms": 30_000,
        "maxLatencyRegressionRatio": 1.25,
        "maxEstimatedCost": 2.0,
        "maxCostRegressionRatio": 1.25,
        "maxProviderFailureRate": .02,
    }


def _write(path, payload):
    path.write_text(json.dumps(payload), encoding="utf-8")


def test_promotion_run_persists_reproducible_fail_closed_decision(tmp_path):
    baseline = tmp_path / "baseline.json"
    candidate = tmp_path / "candidate.json"
    thresholds = tmp_path / "thresholds.json"
    _write(baseline, _evaluation("baseline-model"))
    _write(candidate, _evaluation("candidate-model", _metrics(humanAcceptanceRate=None)))
    _write(thresholds, _thresholds())

    output = run(baseline, candidate, thresholds, tmp_path / "runs")
    decision = json.loads((output / "promotion_decision.json").read_text(encoding="utf-8"))
    manifest = json.loads((output / "manifest.json").read_text(encoding="utf-8"))

    assert decision["decision"] == "INCONCLUSIVE"
    assert decision["baselineIdentity"]["model"] == "baseline-model"
    assert decision["candidateIdentity"]["model"] == "candidate-model"
    assert manifest["networkUsed"] is False
    assert manifest["paidGeneration"] is False
    with pytest.raises(ValueError, match="immutable"):
        run(baseline, candidate, thresholds, tmp_path / "runs")


def test_promotion_run_rejects_non_comparable_datasets(tmp_path):
    baseline = tmp_path / "baseline.json"
    candidate = tmp_path / "candidate.json"
    thresholds = tmp_path / "thresholds.json"
    _write(baseline, _evaluation("baseline-model", dataset_version="dataset-v1"))
    _write(candidate, _evaluation("candidate-model", dataset_version="dataset-v2"))
    _write(thresholds, _thresholds())

    with pytest.raises(ValueError, match="matching datasetVersion"):
        run(baseline, candidate, thresholds, tmp_path / "runs")


def test_promotion_run_requires_explicit_complete_threshold_contract(tmp_path):
    baseline = tmp_path / "baseline.json"
    candidate = tmp_path / "candidate.json"
    thresholds = tmp_path / "thresholds.json"
    _write(baseline, _evaluation("baseline-model"))
    _write(candidate, _evaluation("candidate-model"))
    incomplete = _thresholds()
    incomplete.pop("maxEstimatedCost")
    _write(thresholds, incomplete)

    with pytest.raises(ValueError, match="missing=.*maxEstimatedCost"):
        run(baseline, candidate, thresholds, tmp_path / "runs")


@pytest.mark.parametrize(
    "mutation,expected",
    [
        (lambda payload: payload.update(evaluationRunVersion="0.9.0"), "version must be 1.0.0"),
        (lambda payload: payload["identity"].pop("modelVersion"), "requires modelVersion"),
        (lambda payload: payload["identity"].update(configuration=None), "configuration object"),
    ],
)
def test_promotion_run_rejects_incompatible_or_incomplete_evaluation_envelopes(
    tmp_path,
    mutation,
    expected,
):
    baseline = tmp_path / "baseline.json"
    candidate = tmp_path / "candidate.json"
    thresholds = tmp_path / "thresholds.json"
    invalid = _evaluation("baseline-model")
    mutation(invalid)
    _write(baseline, invalid)
    _write(candidate, _evaluation("candidate-model"))
    _write(thresholds, _thresholds())

    with pytest.raises(ValueError, match=expected):
        run(baseline, candidate, thresholds, tmp_path / "runs")
