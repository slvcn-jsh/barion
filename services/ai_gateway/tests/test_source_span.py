import json
from pathlib import Path

from services.source_span import resolve_source_span, slice_utf16


def test_shared_source_span_contract():
    fixture = json.loads((Path(__file__).parents[2] / "source_span_contract.json").read_text(encoding="utf-8"))
    for case in fixture["cases"]:
        result = resolve_source_span(
            case["source"], case["evidence"], context_before=case.get("contextBefore"),
            context_after=case.get("contextAfter"),
            expected_source_text_sha256=case.get("expectedSourceTextSha256"),
        )
        assert result.status == case["expected"]["status"], case["id"]
        assert result.startOffset == case["expected"]["startOffset"], case["id"]
        assert result.endOffset == case["expected"]["endOffset"], case["id"]
        assert len(result.sourceTextSha256) == len(result.evidenceTextSha256) == 64
        if result.startOffset is not None:
            assert slice_utf16(case["source"], result.startOffset, result.endOffset) is not None


def test_utf16_slice_rejects_surrogate_split():
    assert slice_utf16("A😀B", 1, 2) is None
    assert slice_utf16("A😀B", 1, 3) == "😀"
