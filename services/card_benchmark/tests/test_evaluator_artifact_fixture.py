from __future__ import annotations

from dataclasses import asdict
import json
from pathlib import Path

import pymupdf
import pytest

from services.card_benchmark.evaluator_artifact_fixture import build_fixture
from services.card_benchmark.extraction import extract_source_pages, segment_pages
from services.card_benchmark.io_utils import canonical_json, sha256_file, sha256_text, write_json


SOURCE_TITLE = "Project-owned physiology notes"
SOURCE_TEXT = (
    "Estrogen promotes proliferative changes in the endometrium. "
    "Progesterone supports secretory changes after ovulation. "
    "These project-authored notes exist only to test deterministic evidence reconstruction."
)


def _artifacts(tmp_path: Path) -> tuple[Path, Path, Path]:
    source = tmp_path / "source.pdf"
    document = pymupdf.open()
    page = document.new_page()
    page.insert_textbox(pymupdf.Rect(72, 72, 520, 700), SOURCE_TEXT, fontsize=11)
    document.save(source)
    document.close()

    _page_count, pages = extract_source_pages(source)
    segments = segment_pages(pages, SOURCE_TITLE)
    assert len(segments) == 1
    segment = segments[0]
    evidence = "Estrogen promotes proliferative changes in the endometrium."
    cards = [{
        "cardId": "generated-card-1",
        "cardType": "mechanism",
        "coreAnswer": "Endometrial proliferation is promoted by estrogen.",
        "explanation": "",
        "learningObjective": "Recall estrogen's endometrial effect.",
        "normalizationWarnings": [],
        "question": "What effect does estrogen have on the endometrium?",
        "rawAnswer": "Answer: Endometrial proliferation is promoted by estrogen.",
        "rawInputHash": "fixture-input",
        "rawQuestion": "What effect does estrogen have on the endometrium?",
        "sourceReferences": [{
            "endOffset": len(evidence),
            "evidenceText": evidence,
            "locator": segment.locator,
            "segmentId": segment.segmentId,
            "startOffset": 0,
        }],
        "studyNote": "",
        "system": "barion-ai",
    }]
    run = tmp_path / "run"
    run.mkdir()
    write_json(run / "production_cards.json", cards)
    write_json(run / "manifest.json", {
        "runId": "fixture-run",
        "hashes": {
            "sourceSha256": sha256_file(source),
            "segmentSha256": sha256_text(canonical_json([asdict(item) for item in segments])),
            "productionDeckSha256": sha256_text(canonical_json(cards)),
        },
        "generation": {
            "provider": "fixture",
            "model": "fixture-model",
            "promptVersion": "fixture-prompt-v1",
        },
    })
    governance = tmp_path / "governance.json"
    write_json(governance, {
        "sourceArtifactSha256": sha256_file(source),
        "sourceReference": "project-owned-physiology-notes",
        "sourceType": "project-authored",
        "evaluationUseAuthorized": True,
        "licenseUsageStatus": "approved",
        "containsSensitiveData": False,
        "trainingEligibility": "inference-only",
    })
    return run, source, governance


def test_build_fixture_reconstructs_exact_evidence_and_remains_unlabeled(tmp_path):
    run, source, governance = _artifacts(tmp_path)

    output = build_fixture(
        run,
        source,
        governance,
        tmp_path / "fixture.json",
        source_title=SOURCE_TITLE,
    )
    payload = json.loads(output.read_text(encoding="utf-8"))

    assert payload["provenance"] == "model-generated-evaluation"
    assert payload["selection"]["selectedCaseCount"] == 1
    assert payload["sourceGovernance"]["trainingEligibility"] == "inference-only"
    assert payload["generationProvenance"]["runManifestSha256"]
    assert "goldLabel" not in payload["cases"][0]
    assert payload["cases"][0]["card"]["evidenceText"] in payload["cases"][0]["segments"][0]["text"]


def test_build_fixture_rejects_source_that_does_not_match_run(tmp_path):
    run, source, governance = _artifacts(tmp_path)
    manifest_path = run / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["hashes"]["sourceSha256"] = "0" * 64
    write_json(manifest_path, manifest)

    with pytest.raises(ValueError, match="Source artifact hash"):
        build_fixture(
            run,
            source,
            governance,
            tmp_path / "fixture.json",
            source_title=SOURCE_TITLE,
        )

    assert not (tmp_path / "fixture.json").exists()


def test_build_fixture_rejects_governance_for_different_source(tmp_path):
    run, source, governance = _artifacts(tmp_path)
    declaration = json.loads(governance.read_text(encoding="utf-8"))
    declaration["sourceArtifactSha256"] = "f" * 64
    write_json(governance, declaration)

    with pytest.raises(ValueError, match="different source artifact"):
        build_fixture(
            run,
            source,
            governance,
            tmp_path / "fixture.json",
            source_title=SOURCE_TITLE,
        )


@pytest.mark.parametrize("missing_field", ["runId", "provider", "model", "promptVersion"])
def test_build_fixture_requires_complete_generation_provenance(tmp_path, missing_field):
    run, source, governance = _artifacts(tmp_path)
    manifest_path = run / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    target = manifest if missing_field == "runId" else manifest["generation"]
    target[missing_field] = ""
    write_json(manifest_path, manifest)

    with pytest.raises(ValueError, match="run ID|provider, model, and prompt"):
        build_fixture(
            run,
            source,
            governance,
            tmp_path / "fixture.json",
            source_title=SOURCE_TITLE,
        )
