from services.card_benchmark.phase3_audit import (
    ContradictionClassification,
    classify_contradiction,
    summarize_dispositions,
)
from services.card_benchmark.models import Claim, GroundingResult, NumericValue


def claim(text, *, subject="Drug", relation="is", numbers=(), negation=False):
    return Claim("clm", "card", "core_answer", text, 0, len(text), "factual", subject, relation,
                 tuple(numbers), negation, "low", True)


def test_true_false_specificity_paraphrase_numeric_and_negation_contradictions():
    true = classify_contradiction(claim("Drug increases pressure", relation="increases"), "Drug decreases pressure")
    false = classify_contradiction(claim("Suppression is conscious forgetting"), "Student decides not to think; conscious forgetting")
    specificity = classify_contradiction(claim("Drug may cause nausea"), "Nausea is common with Drug")
    paraphrase = classify_contradiction(claim("Stop medication", relation="stop"), "Discontinue medication")
    numeric = classify_contradiction(claim("Wait 8 hours", numbers=(NumericValue(8, "8 hours", "hour"),)), "Wait 12 hours")
    negation = classify_contradiction(claim("Drug does not cause fever", negation=True), "Drug causes fever")
    assert true.classification == "TRUE_CONTRADICTION"
    assert false.classification == "FALSE_POSITIVE"
    assert specificity.classification == "DIFFERENT_SPECIFICITY"
    assert paraphrase.classification == "COMPATIBLE_PARAPHRASE"
    assert numeric.classification == "NUMERIC_CONTRADICTION"
    assert negation.classification == "NEGATION_CONTRADICTION"


def test_audit_result_has_required_reproducible_fields():
    result = ContradictionClassification("c", "a", "b", "core_answer", "source", ("span",),
                                         "FALSE_POSITIVE", 0.99, "Reason", "FIX_EVALUATOR")
    assert result.cardId == "c" and result.relevantSourceSpans == ("span",)


def test_disposition_summary_separates_root_causes():
    rows = [
        {"cardId": "c1", "field": "core_answer", "sourceSupport": "unsupported", "citationStatus": "missing", "claimType": "dose", "decisionImpact": ["UNSUPPORTED_CLAIM"]},
        {"cardId": "c2", "field": "study_note", "sourceSupport": "unsupported", "citationStatus": "partial", "claimType": "factual", "decisionImpact": ["SOURCE_CONTRADICTION"]},
    ]
    result = summarize_dispositions(rows, {"c1": "REJECT", "c2": "REVIEW"})
    assert result["unsupported core answer"]["count"] == 1
    assert result["unsupported optional enrichment"]["count"] == 1
