import json

from services.card_benchmark.models import Page
from services.card_benchmark.scripts import audit


def test_audit_uses_complete_real_segmentation(monkeypatch, tmp_path):
    cards = tmp_path / "cards.json"
    cards.write_text(json.dumps([{
        "cardId": "c1", "question": "What fact appears near the end?",
        "answer": "Answer: Target fact appears near the end.", "system": "production",
        "segmentId": "placeholder", "evidenceText": "Target fact appears near the end."
    }]), encoding="utf-8")
    source = tmp_path / "source.pdf"; source.write_bytes(b"placeholder")
    text = ("Intro text is present. " * 40) + "Target fact appears near the end. " * 4
    monkeypatch.setattr(audit, "extract_source_pages", lambda _path: (1, [Page("Page 1", text)]))
    output = tmp_path / "audit"
    assert audit.main([str(cards), str(source), str(output)]) == 0
    summary = json.loads((output / "audit_summary.json").read_text(encoding="utf-8"))
    assert summary["segmentCount"] >= 1
    assert summary["claimCount"] == 1
    assert (output / "claims.jsonl").is_file()
