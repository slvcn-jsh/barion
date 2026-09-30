from __future__ import annotations

import json
from pathlib import Path

import pymupdf
import pytest

from services.card_benchmark.authorized_pack_preflight import build_preflight
from services.card_benchmark.authorized_source_registry import REGISTRY_VERSION, extract_registered_text
from services.card_benchmark.io_utils import sha256_file, sha256_text, write_json


def _pack_and_registry(tmp_path: Path) -> tuple[Path, Path, str]:
    pack = tmp_path / "pack"
    text_dir = pack / "inputs" / "text"
    pdf_dir = pack / "inputs" / "pdf"
    text_dir.mkdir(parents=True)
    pdf_dir.mkdir(parents=True)
    private_text = "Estrogen supports a source-bounded benchmark fact. " * 4
    text_path = text_dir / "T01.txt"
    text_path.write_text(private_text, encoding="utf-8")

    pdf_path = pdf_dir / "P01.pdf"
    document = pymupdf.open()
    page = document.new_page()
    page.insert_textbox(
        pymupdf.Rect(72, 72, 520, 700),
        "Progesterone supports a second source-bounded benchmark fact. " * 4,
        fontsize=11,
    )
    document.save(pdf_path)
    document.close()

    sources = []
    for source_id, relative, format_name in (
        ("T01", "inputs/text/T01.txt", "TXT"),
        ("P01", "inputs/pdf/P01.pdf", "PDF"),
    ):
        path = pack / relative
        text, page_count = extract_registered_text(path)
        sources.append({
            "sourceId": source_id,
            "relativePath": relative,
            "format": format_name,
            "artifactSha256": sha256_file(path),
            "extractedTextSha256": sha256_text(text),
            "extractedCharacterCount": len(text),
            "pageCount": page_count,
        })
    registry = tmp_path / "registry.json"
    write_json(registry, {
        "registryVersion": REGISTRY_VERSION,
        "packReference": "fixture-pack",
        "packIdentitySha256": "a" * 64,
        "sourceCount": len(sources),
        "invariants": {"rawContentIncluded": False},
        "sources": sources,
    })
    return pack, registry, private_text


def test_preflight_verifies_pdf_and_text_without_exposing_content(tmp_path):
    pack, registry, private_text = _pack_and_registry(tmp_path)

    output = build_preflight(pack, registry, tmp_path / "preflight.json")
    payload = json.loads(output.read_text(encoding="utf-8"))
    serialized = json.dumps(payload)

    assert payload["sourceCount"] == 2
    assert payload["generationReadySourceCount"] == 2
    assert payload["blockedSourceCount"] == 0
    assert payload["invariants"] == {
        "evaluationDirectoryRead": False,
        "rawContentIncluded": False,
        "providerCallCount": 0,
    }
    assert all(row["segmentCount"] > 0 for row in payload["sources"])
    assert "Estrogen supports" not in serialized
    assert private_text not in serialized


def test_preflight_rejects_source_byte_drift(tmp_path):
    pack, registry, _private_text = _pack_and_registry(tmp_path)
    (pack / "inputs" / "text" / "T01.txt").write_text("changed source", encoding="utf-8")

    with pytest.raises(ValueError, match="source bytes changed"):
        build_preflight(pack, registry, tmp_path / "preflight.json")


def test_preflight_rejects_registry_path_escape(tmp_path):
    pack, registry, _private_text = _pack_and_registry(tmp_path)
    outside = tmp_path / "outside.txt"
    outside.write_text("outside source", encoding="utf-8")
    payload = json.loads(registry.read_text(encoding="utf-8"))
    payload["sources"][0]["relativePath"] = "../outside.txt"
    payload["sources"][0]["artifactSha256"] = sha256_file(outside)
    payload["sources"][0]["extractedTextSha256"] = sha256_text("outside source")
    write_json(registry, payload)

    with pytest.raises(ValueError, match="escapes the inputs directory"):
        build_preflight(pack, registry, tmp_path / "preflight.json")
