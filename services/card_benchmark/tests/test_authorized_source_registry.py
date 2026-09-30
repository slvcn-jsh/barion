from __future__ import annotations

import json
from pathlib import Path

import pytest

from services.card_benchmark.authorized_source_registry import build_registry
from services.card_benchmark.io_utils import write_json


def _pack(tmp_path: Path, *, source_text: str = "Estrogen supports a source-grounded test fact."):
    pack = tmp_path / "pack"
    inputs = pack / "inputs" / "text"
    evaluation = pack / "evaluation"
    inputs.mkdir(parents=True)
    evaluation.mkdir()
    (inputs / "T01.txt").write_text(source_text, encoding="utf-8")
    (pack / "benchmark_manifest.csv").write_text(
        "id,format,file,approx_words,length_class,source_style,primary_test\n"
        "T01,TXT,inputs/text/T01.txt,7,short,clean test source,grounding\n",
        encoding="utf-8",
    )
    write_json(evaluation / "gold_standard.json", {"T01": {"concepts": []}})
    (evaluation / "gold_concepts.csv").write_text(
        "source_id,concept_id,gold_concept\nT01,T01-C01,Source-grounded fact\n",
        encoding="utf-8",
    )
    (evaluation / "SCORING_RUBRIC.md").write_text("# Hidden rubric\n", encoding="utf-8")
    authorization = pack / "source-use-authorization.json"
    write_json(authorization, {
        "authorizationVersion": "1.0.0",
        "authorizationBasis": "owner-declared",
        "authorizedAt": "2026-09-30T00:00:00+08:00",
        "packReference": "fixture-pack",
        "sourceType": "project-authored-benchmark",
        "evaluationUseAuthorized": True,
        "trainingUseAuthorized": True,
        "trainingConsent": "explicit",
        "licenseUsageStatus": "approved",
        "sensitivityStatus": "screened-no-obvious-sensitive-data",
        "containsSensitiveData": False,
        "trainingEligibility": "candidate",
        "publicDistributionAuthorized": False,
    })
    return pack, authorization


def test_registry_hashes_authorized_sources_without_copying_content(tmp_path):
    pack, authorization = _pack(tmp_path)

    output = build_registry(pack, authorization, tmp_path / "registry.json")
    payload = json.loads(output.read_text(encoding="utf-8"))
    serialized = json.dumps(payload)

    assert payload["sourceCount"] == 1
    assert payload["hiddenEvaluationArtifactCount"] == 3
    assert payload["dataUse"]["trainingEligibility"] == "candidate"
    assert payload["invariants"]["recordLevelReviewRequiredBeforeTraining"] is True
    assert payload["sources"][0]["artifactSha256"]
    assert "Estrogen supports" not in serialized


def test_registry_rejects_obvious_sensitive_content(tmp_path):
    pack, authorization = _pack(tmp_path, source_text="Patient MRN 12345 must remain private.")

    with pytest.raises(ValueError, match="sensitive-content screening"):
        build_registry(pack, authorization, tmp_path / "registry.json")


def test_registry_rejects_manifest_path_outside_inputs(tmp_path):
    pack, authorization = _pack(tmp_path)
    outside = tmp_path / "outside.txt"
    outside.write_text("outside", encoding="utf-8")
    (pack / "benchmark_manifest.csv").write_text(
        "id,format,file,approx_words,length_class,source_style,primary_test\n"
        "T01,TXT,../outside.txt,1,short,test,escape\n",
        encoding="utf-8",
    )

    with pytest.raises(ValueError, match="escapes the inputs directory"):
        build_registry(pack, authorization, tmp_path / "registry.json")
