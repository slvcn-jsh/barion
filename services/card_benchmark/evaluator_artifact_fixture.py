from __future__ import annotations

import argparse
from dataclasses import asdict
from pathlib import Path
from typing import Any

from services.source_span import resolve_source_span

from .evaluator_calibration import CALIBRATION_VERSION
from .evaluator_fixture import MODEL_GENERATED_PROVENANCE, validate_evaluator_fixture
from .extraction import extract_source_pages, segment_pages
from .io_utils import canonical_json, read_json, sha256_file, sha256_text, write_json

MAX_FIXTURE_CASES = 50
_GOVERNANCE_FIELDS = (
    "sourceArtifactSha256",
    "sourceReference",
    "sourceType",
    "evaluationUseAuthorized",
    "licenseUsageStatus",
    "containsSensitiveData",
    "trainingEligibility",
    "trainingUseAuthorized",
    "trainingConsent",
)


def build_fixture(
    run_path: Path,
    source_path: Path,
    governance_path: Path,
    output_path: Path,
    *,
    source_title: str,
    max_cases: int = MAX_FIXTURE_CASES,
) -> Path:
    run_path = run_path.resolve()
    source_path = source_path.resolve()
    governance_path = governance_path.resolve()
    output_path = output_path.resolve()
    if output_path.exists():
        raise ValueError(f"Evaluator fixture already exists: {output_path}")
    if not 1 <= max_cases <= MAX_FIXTURE_CASES:
        raise ValueError(f"max_cases must be between 1 and {MAX_FIXTURE_CASES}.")
    if not source_title.strip():
        raise ValueError("source_title is required to reproduce stable source segments.")

    manifest_path = run_path / "manifest.json"
    cards_path = run_path / "production_cards.json"
    manifest = read_json(manifest_path)
    cards = read_json(cards_path)
    governance_raw = read_json(governance_path)
    if not isinstance(manifest, dict) or not isinstance(cards, list) or not cards:
        raise ValueError("Benchmark run is missing a valid manifest or production deck.")
    if not isinstance(governance_raw, dict):
        raise ValueError("Source governance declaration must be an object.")
    hashes = manifest.get("hashes")
    generation = manifest.get("generation")
    if not isinstance(hashes, dict) or not isinstance(generation, dict):
        raise ValueError("Benchmark manifest is missing hashes or generation provenance.")
    run_id = manifest.get("runId")
    generation_identity = {
        field: generation.get(field)
        for field in ("provider", "model", "promptVersion")
    }
    if not isinstance(run_id, str) or not run_id.strip():
        raise ValueError("Benchmark manifest requires a non-empty run ID.")
    if any(not isinstance(value, str) or not value.strip() for value in generation_identity.values()):
        raise ValueError("Benchmark manifest requires provider, model, and prompt version provenance.")

    source_hash = sha256_file(source_path)
    if hashes.get("sourceSha256") != source_hash:
        raise ValueError("Source artifact hash does not match benchmark manifest.")
    deck_hash = sha256_text(canonical_json(cards))
    if hashes.get("productionDeckSha256") != deck_hash:
        raise ValueError("Production deck hash does not match benchmark manifest.")

    _page_count, pages = extract_source_pages(source_path)
    segments = segment_pages(pages, source_title.strip())
    segment_hash = sha256_text(canonical_json([asdict(segment) for segment in segments]))
    if hashes.get("segmentSha256") != segment_hash:
        raise ValueError("Reconstructed source segments do not match benchmark manifest.")
    segment_by_id = {segment.segmentId: segment for segment in segments}
    if len(segment_by_id) != len(segments):
        raise ValueError("Reconstructed source segment IDs are not unique.")

    governance = {field: governance_raw.get(field) for field in _GOVERNANCE_FIELDS}
    if governance.get("sourceArtifactSha256") != source_hash:
        raise ValueError("Governance declaration targets a different source artifact.")

    cases = [
        _case_from_card(card, segment_by_id, run_id)
        for card in cards[:max_cases]
    ]
    payload: dict[str, Any] = {
        "fixtureVersion": CALIBRATION_VERSION,
        "provenance": MODEL_GENERATED_PROVENANCE,
        "sourceGovernance": governance,
        "generationProvenance": {
            "runId": run_id,
            "runManifestSha256": sha256_file(manifest_path),
            "productionDeckSha256": deck_hash,
            **generation_identity,
        },
        "selection": {
            "strategy": "stable-run-order",
            "availableCardCount": len(cards),
            "selectedCaseCount": len(cases),
            "maxCases": max_cases,
        },
        "cases": cases,
    }
    validate_evaluator_fixture(payload, require_labels=False)
    write_json(output_path, payload)
    return output_path


def _case_from_card(
    card: object,
    segment_by_id: dict[str, Any],
    run_id: str,
) -> dict[str, object]:
    if not isinstance(card, dict):
        raise ValueError("Every production card must be an object.")
    references = card.get("sourceReferences")
    if not isinstance(references, list) or len(references) != 1 or not isinstance(references[0], dict):
        raise ValueError(f"Card {card.get('cardId')!r} must declare exactly one source reference.")
    reference = references[0]
    segment_id = reference.get("segmentId")
    segment = segment_by_id.get(segment_id)
    if segment is None:
        raise ValueError(f"Card {card.get('cardId')!r} references an unknown source segment.")
    evidence_text = reference.get("evidenceText")
    resolution = resolve_source_span(segment.text, evidence_text)
    if resolution.status not in {"exact", "normalized", "context-disambiguated"}:
        raise ValueError(
            f"Card {card.get('cardId')!r} evidence is not uniquely resolvable in its source segment."
        )
    required_card_fields = ("cardId", "question", "rawAnswer", "system")
    if any(not isinstance(card.get(field), str) or not card[field].strip() for field in required_card_fields):
        raise ValueError("Production card is missing required identity or content fields.")
    return {
        "caseId": f"{run_id}:{card['cardId']}",
        "segments": [{
            "segmentId": segment.segmentId,
            "locator": segment.locator,
            "sectionPath": segment.sectionPath,
            "text": segment.text,
            "startOffset": segment.startOffset,
            "endOffset": segment.endOffset,
        }],
        "card": {
            "cardId": card["cardId"],
            "question": card["question"],
            "answer": card["rawAnswer"],
            "system": card["system"],
            "segmentId": segment.segmentId,
            "locator": reference.get("locator", segment.locator),
            "cardType": card.get("cardType", ""),
            "learningObjective": card.get("learningObjective", ""),
            "evidenceText": evidence_text,
        },
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Build an unlabeled, governed evaluator fixture from an immutable benchmark run."
    )
    parser.add_argument("--run", type=Path, required=True)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--governance", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--source-title", required=True)
    parser.add_argument("--max-cases", type=int, default=MAX_FIXTURE_CASES)
    args = parser.parse_args(argv)
    output = build_fixture(
        args.run,
        args.source,
        args.governance,
        args.output,
        source_title=args.source_title,
        max_cases=args.max_cases,
    )
    print(output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
