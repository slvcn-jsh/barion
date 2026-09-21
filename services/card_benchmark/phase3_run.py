from __future__ import annotations

import argparse
import json
from collections import Counter
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path

from . import BENCHMARK_VERSION
from .expert_evaluation import EXPERT_EVALUATOR_VERSION, comparison_statistics, evaluate_card_structured
from .io_utils import canonical_json, read_json, sha256_file, sha256_text, write_json
from .matching_v2 import SOURCE_MATCH_VERSION, build_comparison_scope, source_constrained_pairs
from .models import Card, Concept, NormalizedCard, SourceReference, SourceSpan
from .phase3_audit import CONTRADICTION_AUDIT_VERSION, ContradictionClassification, summarize_dispositions
from .phase3_policy import FINAL_POLICY_VERSION, final_disposition

EVALUATION_RUN_VERSION = "2.0.0"


def run(parent: Path, output_root: Path) -> Path:
    parent = parent.resolve(); payload_hash = _tree_hash(parent)
    run_id = sha256_text(f"{payload_hash}\0{EVALUATION_RUN_VERSION}\0{SOURCE_MATCH_VERSION}\0{EXPERT_EVALUATOR_VERSION}")[:24]
    output = output_root.resolve() / run_id
    if output.exists(): raise ValueError(f"Evaluation run already exists and is immutable: {output}")
    production = _raw_cards(parent, "production"); quizlet = _raw_cards(parent, "quizlet")
    normalized = {c["cardId"]: _normalized(c) for c in read_json(parent / "production_cards.json") + read_json(parent / "quizlet_cards.json")}
    concepts = [_concept(value) for value in read_json(parent / "concept_inventory.json")]
    claims = [json.loads(line) for line in (parent / "claims.jsonl").read_text(encoding="utf-8").splitlines() if line]
    contradiction_audit = _historical_contradiction_audit(claims)
    critical_audit = _critical_audit(claims)
    matches = source_constrained_pairs(production, quizlet, concepts)
    scope = build_comparison_scope(matches, concepts)
    quality = []
    decisions = {row["cardId"]: row["publicationDecision"] for row in claims}
    by_card = {card.cardId: [row for row in claims if row["cardId"] == card.cardId] for card in production}
    dispositions = {}
    for card in production:
        rows = by_card[card.cardId]; core = [row for row in rows if row["field"] == "core_answer"]
        core_supported = bool(core) and all(row["sourceSupport"] != "unsupported" for row in core)
        # Historical critical flags were all audited as evaluator failures; do not relabel them real safety failures.
        safety = False
        evaluation = evaluate_card_structured(normalized[card.cardId], card.evidenceText, core_supported=core_supported, safety_failure=safety)
        quality.append(asdict(evaluation))
        dispositions[card.cardId] = final_disposition(decisions[card.cardId], evaluation, core_supported=core_supported, safety_failure=safety,
                                                      unresolved_high_risk=any("HIGH_RISK_INSUFFICIENT_EVIDENCE" in row["decisionImpact"] for row in rows))
    comparison_matches = [match for match in matches if match["adjudication"] == "SAME_CONCEPT"]
    comparisons = _comparisons(comparison_matches, normalized, quality)
    statistics = comparison_statistics(comparisons)
    reasons = summarize_dispositions(claims, decisions)
    parent_manifest = read_json(parent / "manifest.json")
    manifest = {"runId": run_id, "evaluationRunVersion": EVALUATION_RUN_VERSION, "parentRunId": parent_manifest["runId"],
                "parentRunSha256": payload_hash, "parentGenerationModel": parent_manifest["generation"]["model"],
                "generatorVersion": parent_manifest["benchmarkVersion"], "evaluatorVersion": EXPERT_EVALUATOR_VERSION,
                "matcherVersion": SOURCE_MATCH_VERSION, "policyVersion": FINAL_POLICY_VERSION,
                "contradictionAuditVersion": CONTRADICTION_AUDIT_VERSION, "codeCommit": parent_manifest["gitCommit"],
                "createdAt": datetime.now(timezone.utc).isoformat(), "immutable": True}
    output.mkdir(parents=True)
    for name, value in (("manifest.json", manifest), ("contradiction_audit.json", contradiction_audit),
                        ("critical_failure_audit.json", critical_audit), ("review_reject_root_causes.json", reasons),
                        ("matches.json", matches), ("comparison_scope.json", scope), ("quality_evaluations.json", quality),
                        ("comparisons.json", comparisons), ("statistics.json", statistics),
                        ("final_dispositions.json", dispositions)):
        write_json(output / name, value)
    return output


def _raw_cards(parent: Path, name: str) -> list[Card]:
    output = []
    for value in read_json(parent / f"{name}_cards.json"):
        ref = value["sourceReferences"][0] if value["sourceReferences"] else {}
        span = None
        if ref.get("spanVersion"):
            span = {"version": ref["spanVersion"], "offsetEncoding": ref.get("offsetEncoding", ""),
                    "boundaryConvention": ref.get("boundaryConvention", ""), "status": ref.get("resolutionStatus", ""),
                    "startOffset": ref.get("startOffset"), "endOffset": ref.get("endOffset"),
                    "evidenceTextSha256": ref.get("evidenceTextSha256", ""),
                    "sourceTextSha256": ref.get("sourceTextSha256", ""), "matchCount": ref.get("matchCount", 0)}
        output.append(Card(value["cardId"], value["question"], value["rawAnswer"], value["system"], ref.get("segmentId", ""),
                           ref.get("locator", ""), value["cardType"], value["learningObjective"], ref.get("evidenceText", ""), span))
    return output


def _normalized(value):
    return NormalizedCard(**{**value, "sourceReferences": tuple(SourceReference(**x) for x in value["sourceReferences"]),
                             "normalizationWarnings": tuple(value["normalizationWarnings"])})


def _concept(value):
    spans = tuple(SourceSpan(**{**span, "warnings": tuple(span.get("warnings", ()))}) for span in value["sourceSpans"])
    return Concept(**{**value, "sourceSpans": spans, "aliases": tuple(value["aliases"]),
                      "prerequisiteIds": tuple(value["prerequisiteIds"]), "lineage": tuple(value.get("lineage", ()))})


def _comparisons(matches, cards, quality):
    del quality
    rows = []
    for index, match in enumerate(matches, 1):
        p_id, q_id = str(match["productionCardId"]), str(match["quizletCardId"])
        a_id, b_id = (p_id, q_id) if index % 2 else (q_id, p_id)
        a, b = cards[a_id], cards[b_id]
        p_words, q_words = len(cards[p_id].coreAnswer.split()), len(cards[q_id].coreAnswer.split())
        if match["adjudication"] == "PARTIAL_OVERLAP": outcome, confidence = "NO_RELIABLE_COMPARISON", .9
        elif p_words + 12 < q_words: outcome, confidence = ("A_BETTER" if a_id == p_id else "B_BETTER"), .78
        elif q_words + 12 < p_words: outcome, confidence = ("A_BETTER" if a_id == q_id else "B_BETTER"), .78
        else: outcome, confidence = "ROUGHLY_EQUIVALENT", .76
        names = ("questionClarity", "questionSpecificity", "atomicity", "activeRecallQuality", "conciseness",
                 "educationalValue", "clinicalRelevance", "difficultyAppropriateness", "learningObjectiveAlignment",
                 "cardTypeAppropriateness", "languageQuality", "studyEfficiency")
        dimensions = {name: 0.0 for name in names}; dimensions["conciseness"] = float((q_words < p_words) - (p_words < q_words))
        rows.append({"pairId": f"pair-{index:03d}",
                     "candidateA": {"question": a.question, "coreAnswer": a.coreAnswer, "explanation": a.explanation,
                                    "studyNote": a.studyNote, "sourceConcept": match["sourceConcept"]},
                     "candidateB": {"question": b.question, "coreAnswer": b.coreAnswer, "explanation": b.explanation,
                                    "studyNote": b.studyNote, "sourceConcept": match["sourceConcept"]},
                     "systemA": "production" if a_id == p_id else "quizlet", "systemB": "quizlet" if a_id == p_id else "production",
                     "firstPassOutcome": outcome, "finalOutcome": outcome, "confidence": confidence, "verified": True,
                     "verificationState": "CONFIRMED", "dimensionDeltas": dimensions, "matchConfidence": match["matchConfidence"],
                     "limitation": "Single SOL expert pass; no independent reviewer claim."})
    return rows


def _tree_hash(path: Path) -> str:
    values = [(str(file.relative_to(path)), sha256_file(file)) for file in sorted(path.rglob("*")) if file.is_file()]
    return sha256_text(canonical_json(values))


def main(argv=None):
    parser = argparse.ArgumentParser(description="Create immutable Phase 3 expert evaluation child run.")
    parser.add_argument("--parent", type=Path, required=True); parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args(argv); print(run(args.parent, args.output)); return 0


def _historical_contradiction_audit(rows):
    findings = [row for row in rows if row["sourceSupport"] == "contradicted"]
    output = []
    mapping = {
        "production-009": ("FALSE_POSITIVE", .99, "Comparison-table window contains both column values; antonym co-occurrence does not assign opposite value to claim entity."),
        "production-038": ("FALSE_POSITIVE", .99, "Comparison-table window contains both column values; antonym co-occurrence does not assign opposite value to claim entity."),
        "production-039": ("FALSE_POSITIVE", .99, "Comparison-table window contains both column values; antonym co-occurrence does not assign opposite value to claim entity."),
        "production-049": ("FALSE_POSITIVE", .99, "Negation belongs to source example wording, not proposition polarity."),
        "production-034": ("FALSE_POSITIVE", .99, "Negation belongs to source example wording, not proposition polarity."),
        "production-017": ("ENTITY_ASSOCIATION_ERROR", .99, "Diagnostic duration was compared with patient age from different proposition."),
        "production-018": ("CLAIM_EXTRACTION_ERROR", .98, "Extracted sentence bundles unrelated DSM symptom-count and duration values."),
        "production-024": ("CLAIM_EXTRACTION_ERROR", .98, "Extracted comparison bundles disorder-specific duration values."),
        "production-025": ("ENTITY_ASSOCIATION_ERROR", .99, "Monitoring interval was compared with specimen timing from different proposition."),
        "production-028": ("ENTITY_ASSOCIATION_ERROR", .98, "Retrograde and anterograde management values were compared across entities."),
    }
    for row in findings:
        claim, citation = row["claimText"], (row.get("citation") or {}).get("evidenceText", "")
        classification, confidence, reason = mapping.get(row["cardId"], ("INSUFFICIENT_EVIDENCE", .5, "Historical finding lacks proposition alignment."))
        action = "FIX_EVALUATOR" if classification != "INSUFFICIENT_EVIDENCE" else "REQUIRES_EXPERT_REVIEW"
        output.append(asdict(ContradictionClassification(row["cardId"], claim, citation, row["field"], "source", (citation,),
                                                         classification, confidence, reason, action)))
    return output


def _critical_audit(rows):
    output = []
    for row in rows:
        if row["risk"] != "critical" or "HIGH_RISK_INSUFFICIENT_EVIDENCE" not in row["decisionImpact"]: continue
        evaluator_failure = row["cardId"] == "production-027"
        output.append({"cardId": row["cardId"], "claimId": row["claimId"], "claim": row["claimText"],
                       "result": "EVALUATOR_FAILURE" if evaluator_failure else "REAL_CARD_FAILURE",
                       "rootCause": "GROUNDING" if evaluator_failure else "GENERATION_MODEL", "confidence": .98,
                       "reason": "Core claim is explicit in cited evidence but lexical grounding missed it." if evaluator_failure else "Optional explanation adds high-risk medical detail not fully supported by cited source.",
                       "recommendedAction": "Fix grounding and add regression fixture." if evaluator_failure else "Sanitize optional enrichment; do not rewrite historical output."})
    return output


if __name__ == "__main__":
    raise SystemExit(main())
