from __future__ import annotations

import argparse
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

from services.source_span import SOURCE_SPAN_VERSION, resolve_source_span

from .expert_evaluation import EXPERT_EVALUATOR_VERSION, evaluate_card_structured
from .extraction import extract_source_pages, segment_pages
from .io_utils import read_json, sha256_text, write_json
from .models import Card, Segment
from .phase3_policy import FINAL_POLICY_VERSION, final_disposition
from .phase3_run import _tree_hash
from .kernel import evaluate_card

PHASE4_EVALUATION_VERSION = "1.0.0"


def run(parent: Path, output_root: Path) -> Path:
    parent = parent.resolve()
    parent_hash = _tree_hash(parent)
    run_id = sha256_text(f"{parent_hash}\0{PHASE4_EVALUATION_VERSION}\0{SOURCE_SPAN_VERSION}")[:24]
    output = output_root.resolve() / run_id
    if output.exists():
        raise ValueError(f"Phase 4 evaluation run already exists and is immutable: {output}")

    raw_cards = read_json(parent / "production_cards.json")
    source_path = parent.parent.parent / read_json(parent / "manifest.json")["inputs"]["sourceFilename"]
    if not source_path.is_file():
        raise ValueError(f"Original source is unavailable for deterministic span re-evaluation: {source_path}")
    _page_count, pages = extract_source_pages(source_path)
    source_title = "Comprehensive Psychiatric Nursing Review"
    extracted_segments = segment_pages(pages, source_title)
    segment_text = {segment.segmentId: {"locator": segment.locator, "sectionPath": segment.sectionPath,
                                       "text": segment.text} for segment in extracted_segments}
    cards: list[Card] = []
    provenance: list[dict[str, object]] = []
    for value in raw_cards:
        reference = value["sourceReferences"][0] if value["sourceReferences"] else {}
        segment_id = reference.get("segmentId", "")
        source = segment_text.get(segment_id, {}).get("text", "")
        resolution = resolve_source_span(source, reference.get("evidenceText", ""))
        span = resolution.to_dict()
        cards.append(Card(
            value["cardId"], value["question"], value["rawAnswer"], value["system"], segment_id,
            reference.get("locator", ""), value["cardType"], value["learningObjective"],
            reference.get("evidenceText", ""), span,
        ))
        provenance.append({"cardId": value["cardId"], "segmentId": segment_id, **span})

    segments = [Segment(segment_id, data["locator"], data["sectionPath"], data["text"], 0, len(data["text"]))
                for segment_id, data in segment_text.items()]
    evaluations = [evaluate_card(card, segments) for card in cards]
    dispositions: dict[str, str] = {}
    for card, evaluation in zip(cards, evaluations):
        core = [claim for claim in evaluation["claims"] if claim.location == "core_answer"]
        grounding = {item.claimId: item for item in evaluation["grounding"]}
        core_supported = bool(core) and all(grounding[item.claimId].sourceSupport != "unsupported" for item in core)
        expert = evaluate_card_structured(evaluation["normalizedCard"], card.evidenceText,
                                          core_supported=core_supported, safety_failure=False)
        dispositions[card.cardId] = final_disposition(
            evaluation["policy"].decision, expert, core_supported=core_supported, safety_failure=False,
            unresolved_high_risk=any(item.severity in {"critical", "high"} for item in evaluation["validations"]),
        )

    old_evaluation = parent.parent.parent / "evaluation-runs" / "e5fbe83b8d865684f81100a9" / "final_dispositions.json"
    before = read_json(old_evaluation) if old_evaluation.is_file() else {}
    disposition_changes = {card_id: {"before": before.get(card_id), "after": value}
                           for card_id, value in dispositions.items() if before.get(card_id) != value}
    report = _report(parent, provenance, before, dispositions)
    report["dispositionChangeCount"] = len(disposition_changes)
    manifest = {
        "runId": run_id, "phase4EvaluationVersion": PHASE4_EVALUATION_VERSION,
        "sourceSpanVersion": SOURCE_SPAN_VERSION, "parentRunId": read_json(parent / "manifest.json")["runId"],
        "parentRunSha256": parent_hash, "evaluatorVersion": EXPERT_EVALUATOR_VERSION,
        "policyVersion": FINAL_POLICY_VERSION, "createdAt": datetime.now(timezone.utc).isoformat(),
        "immutable": True, "paidRegeneration": False,
    }
    output.mkdir(parents=True)
    write_json(output / "manifest.json", manifest)
    write_json(output / "source_spans.json", provenance)
    write_json(output / "final_dispositions.json", dispositions)
    write_json(output / "disposition_changes.json", disposition_changes)
    write_json(output / "summary.json", report)
    (output / "report.md").write_text(_report_markdown(report), encoding="utf-8")
    return output



def _report(parent: Path, provenance: list[dict[str, object]], before: dict[str, str], after: dict[str, str]):
    statuses = Counter(str(value["status"]) for value in provenance)
    resolved = sum(statuses[name] for name in ("exact", "normalized", "context-disambiguated"))
    return {
        "parent": str(parent), "cardCount": len(provenance),
        "provenanceBefore": {"legacy-unresolved": len(provenance)},
        "provenanceAfter": dict(sorted(statuses.items())), "resolvedSpanCount": resolved,
        "dispositionsBefore": dict(sorted(Counter(before.values()).items())),
        "dispositionsAfter": dict(sorted(Counter(after.values()).items())),
    }


def _report_markdown(report: dict[str, object]) -> str:
    return "\n".join([
        "# Phase 4 source-span re-evaluation", "", f"Parent: `{report['parent']}`", "",
        f"- Cards: {report['cardCount']}", f"- Resolved spans: {report['resolvedSpanCount']}",
        f"- Provenance before: `{report['provenanceBefore']}`", f"- Provenance after: `{report['provenanceAfter']}`",
        f"- Dispositions before: `{report['dispositionsBefore']}`", f"- Dispositions after: `{report['dispositionsAfter']}`",
        f"- Changed dispositions: {report['dispositionChangeCount']}",
        "", "No provider call or paid regeneration was performed.",
    ]) + "\n"


def main(argv=None):
    parser = argparse.ArgumentParser(description="Create immutable Phase 4 source-span evaluation child run.")
    parser.add_argument("--parent", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args(argv)
    print(run(args.parent, args.output))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
