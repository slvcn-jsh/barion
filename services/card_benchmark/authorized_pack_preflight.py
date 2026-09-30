from __future__ import annotations

import argparse
from collections import Counter
from pathlib import Path
from typing import Any

from .authorized_source_registry import REGISTRY_VERSION, extract_registered_text
from .extraction import extract_source_pages, segment_pages
from .io_utils import read_json, sha256_file, sha256_text, write_json
from .models import Page

PREFLIGHT_VERSION = "1.0.0"


def build_preflight(pack_path: Path, registry_path: Path, output_path: Path) -> Path:
    pack_path = pack_path.resolve()
    registry_path = registry_path.resolve()
    output_path = output_path.resolve()
    if output_path.exists():
        raise ValueError(f"Benchmark preflight already exists: {output_path}")

    registry = read_json(registry_path)
    sources = _registry_sources(registry)
    rows = [_preflight_source(pack_path, source) for source in sources]
    ready_count = sum(bool(row["generationReady"]) for row in rows)
    payload = {
        "preflightVersion": PREFLIGHT_VERSION,
        "packReference": registry["packReference"],
        "registrySha256": sha256_file(registry_path),
        "packIdentitySha256": registry["packIdentitySha256"],
        "sourceCount": len(rows),
        "generationReadySourceCount": ready_count,
        "blockedSourceCount": len(rows) - ready_count,
        "invariants": {
            "evaluationDirectoryRead": False,
            "rawContentIncluded": False,
            "providerCallCount": 0,
        },
        "sources": rows,
    }
    write_json(output_path, payload)
    return output_path


def _registry_sources(registry: object) -> list[dict[str, Any]]:
    if not isinstance(registry, dict) or registry.get("registryVersion") != REGISTRY_VERSION:
        raise ValueError("Authorized source registry is missing or incompatible.")
    if registry.get("invariants", {}).get("rawContentIncluded") is not False:
        raise ValueError("Authorized source registry must be content-free.")
    if not isinstance(registry.get("packReference"), str) or not registry["packReference"].strip():
        raise ValueError("Authorized source registry requires a pack reference.")
    if not isinstance(registry.get("packIdentitySha256"), str):
        raise ValueError("Authorized source registry requires pack identity.")
    sources = registry.get("sources")
    if not isinstance(sources, list) or not sources or not all(isinstance(row, dict) for row in sources):
        raise ValueError("Authorized source registry requires source records.")
    if registry.get("sourceCount") != len(sources):
        raise ValueError("Authorized source registry count does not match source records.")
    ids = [row.get("sourceId") for row in sources]
    if not all(isinstance(value, str) and value.strip() for value in ids) or len(ids) != len(set(ids)):
        raise ValueError("Authorized source registry IDs must be unique non-empty strings.")
    return sources


def _preflight_source(pack_path: Path, source: dict[str, Any]) -> dict[str, object]:
    required = ("sourceId", "relativePath", "artifactSha256", "extractedTextSha256", "format")
    if any(not isinstance(source.get(field), str) or not source[field].strip() for field in required):
        raise ValueError("Authorized source registry record is incomplete.")
    relative = Path(source["relativePath"])
    path = (pack_path / relative).resolve()
    _require_within(path, pack_path / "inputs")
    if not path.is_file():
        raise ValueError(f"Registered benchmark source is missing: {source['sourceId']}")
    if sha256_file(path) != source["artifactSha256"]:
        raise ValueError(f"Registered benchmark source bytes changed: {source['sourceId']}")

    extracted_text, registered_page_count = extract_registered_text(path)
    if sha256_text(extracted_text) != source["extractedTextSha256"]:
        raise ValueError(f"Registered benchmark extracted text changed: {source['sourceId']}")
    if registered_page_count != source.get("pageCount"):
        raise ValueError(f"Registered benchmark page count changed: {source['sourceId']}")

    pages = _source_pages(path, extracted_text, source["artifactSha256"])
    segments = segment_pages(pages, source["sourceId"])
    warning_counts = Counter(warning for page in pages for warning in page.extractionWarnings)
    blockers: list[str] = []
    if not extracted_text.strip():
        blockers.append("missing_extractable_text")
    if not segments:
        blockers.append("no_generation_segments")
    return {
        "sourceId": source["sourceId"],
        "relativePath": source["relativePath"],
        "format": source["format"],
        "artifactSha256": source["artifactSha256"],
        "extractedTextSha256": source["extractedTextSha256"],
        "extractedCharacterCount": len(extracted_text),
        "pageCount": len(pages),
        "textBearingPageCount": sum(bool(page.text.strip()) for page in pages),
        "segmentCount": len(segments),
        "segmentIdentitySha256": sha256_text("\n".join(segment.segmentId for segment in segments)),
        "extractionWarnings": dict(sorted(warning_counts.items())),
        "generationReady": not blockers,
        "blockers": blockers,
    }


def _source_pages(path: Path, extracted_text: str, artifact_hash: str) -> list[Page]:
    if path.suffix.lower() == ".pdf":
        _page_count, pages = extract_source_pages(path)
        return pages
    return [Page(
        locator="Text 1",
        text=extracted_text,
        pageIndex=0,
        sourceArtifactId=f"source-{artifact_hash[:20]}",
    )]


def _require_within(path: Path, root: Path) -> None:
    try:
        path.relative_to(root.resolve())
    except ValueError as error:
        raise ValueError("Registered benchmark path escapes the inputs directory.") from error


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Verify and preflight authorized benchmark sources without reading hidden evaluation data."
    )
    parser.add_argument("--pack", type=Path, required=True)
    parser.add_argument("--registry", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args(argv)
    print(build_preflight(args.pack, args.registry, args.output))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
