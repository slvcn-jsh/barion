#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from pathlib import Path

from services.card_benchmark.extraction import extract_source_pages, segment_pages
from services.card_benchmark.kernel import claim_artifact_rows, evaluate_card
from services.card_benchmark.models import Card


def parser() -> argparse.ArgumentParser:
    value = argparse.ArgumentParser(description="Evaluate cached cards against complete real source segmentation.")
    value.add_argument("production_cards", type=Path)
    value.add_argument("source_pdf", type=Path)
    value.add_argument("output_dir", type=Path)
    value.add_argument("--source-title", default="Benchmark source")
    value.add_argument("--run-id", default="standalone-audit")
    return value


def main(argv: list[str] | None = None) -> int:
    args = parser().parse_args(argv)
    raw_cards = json.loads(args.production_cards.read_text(encoding="utf-8"))
    cards = [_read_card(raw) for raw in raw_cards]
    _page_count, pages = extract_source_pages(args.source_pdf)
    segments = segment_pages(pages, args.source_title)
    evaluations = [evaluate_card(card, segments) for card in cards]
    claims = [row for evaluation in evaluations for row in claim_artifact_rows(args.run_id, evaluation)]
    summary = {
        "runId": args.run_id, "cardCount": len(cards), "segmentCount": len(segments), "claimCount": len(claims),
        "decisions": {decision: sum(evaluation["policy"].decision == decision for evaluation in evaluations)
                      for decision in ("PUBLISH", "SANITIZE", "REVIEW", "REJECT")},
    }
    args.output_dir.mkdir(parents=True, exist_ok=False)
    (args.output_dir / "audit_summary.json").write_text(json.dumps(summary, sort_keys=True, indent=2) + "\n", encoding="utf-8")
    (args.output_dir / "claims.jsonl").write_text("".join(json.dumps(row, sort_keys=True) + "\n" for row in claims), encoding="utf-8")
    return 0



def _read_card(raw: dict[str, object]) -> Card:
    answer = str(raw.get("rawAnswer", raw.get("answer", "")))
    references = raw.get("sourceReferences") or []
    reference = references[0] if isinstance(references, list) and references else {}
    return Card(
        cardId=str(raw["cardId"]), question=str(raw.get("rawQuestion", raw.get("question", ""))),
        answer=answer, system=str(raw.get("system", "production")),
        segmentId=str(raw.get("segmentId", reference.get("segmentId", ""))),
        locator=str(raw.get("locator", reference.get("locator", ""))), cardType=str(raw.get("cardType", "")),
        learningObjective=str(raw.get("learningObjective", "")),
        evidenceText=str(raw.get("evidenceText", reference.get("evidenceText", ""))),
    )


if __name__ == "__main__":
    raise SystemExit(main())
