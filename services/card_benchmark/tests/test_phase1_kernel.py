from dataclasses import replace

from services.card_benchmark.claims import extract_claims, extract_numeric_values
from services.card_benchmark.kernel import evaluate_card
from services.card_benchmark.models import Card, Segment
from services.card_benchmark.normalization import normalize_card, normalize_cards
from services.card_benchmark.reporting import assert_compatible_artifacts
from services.card_benchmark.validators import validate_deck


def segment(identifier: str, text: str) -> Segment:
    return Segment(identifier, "Page 1", "Topic", text, 0, len(text))


def card(answer: str, evidence: str, segment_id: str = "s1") -> Card:
    return Card("c1", "What does metformin do?", answer, "production", segment_id, "Page 1",
                "mechanism", "Recall metformin action.", evidence)


def test_normalization_separates_fields_and_preserves_raw_input():
    raw = "Answer: Core fact.\nWhy it matters: Explanation fact.\nStudy note: Note fact."
    normalized = normalize_card(card(raw, "Core fact."))
    assert normalized.coreAnswer == "Core fact."
    assert normalized.explanation == "Explanation fact."
    assert normalized.studyNote == "Note fact."
    assert normalized.rawAnswer == raw
    assert normalized.rawInputHash
    quizlet = normalize_card(Card("q", "Question?", "Only answer", "quizlet"))
    assert quizlet.coreAnswer == "Only answer"
    assert quizlet.explanation == quizlet.studyNote == ""


def test_decimal_and_range_extraction_preserve_values():
    values = extract_numeric_values("Toxicity starts at 1.5 mEq/L; range 2-4 hours.")
    assert [(value.value, value.endValue, value.unit) for value in values] == [
        (1.5, None, "meq/l"), (2.0, 4.0, "hour")
    ]


def test_all_normalized_fields_have_claim_or_explicit_empty_state():
    normalized = normalize_card(card("Answer: Metformin reduces glucose.", "Metformin reduces glucose."))
    claims, states = extract_claims(normalized)
    assert claims
    assert set(states) == {"question", "core_answer", "explanation", "study_note", "learning_objective"}
    assert set(states.values()) <= {"claims_extracted", "no_factual_claim"}


def test_citation_segment_and_document_tiers_are_distinct():
    full = segment("s1", "Metformin reduces hepatic glucose production. It improves glucose control.")
    cited = card("Answer: Metformin reduces hepatic glucose production.", "Metformin reduces hepatic glucose production.")
    exact = evaluate_card(cited, [full])
    assert exact["grounding"][0].sourceSupport == "supported_by_citation"
    assert exact["grounding"][0].citationStatus == "exact"

    segment_only = card("Answer: Metformin improves glucose control.", "Metformin reduces hepatic glucose production.")
    middle = evaluate_card(segment_only, [full])
    assert middle["grounding"][0].sourceSupport == "supported_by_segment"
    assert middle["grounding"][0].citationStatus == "partial"

    other = segment("s2", "Metformin improves glucose control.")
    document = evaluate_card(segment_only, [segment("s1", "Unrelated introduction about metformin."), other])
    assert document["grounding"][0].sourceSupport == "supported_elsewhere_in_source"


def test_unsupported_plausible_claim_never_becomes_source_grounded():
    evaluation = evaluate_card(card("Answer: Water freezes at 0 degrees Celsius.", "Metformin reduces glucose."),
                               [segment("s1", "Metformin reduces glucose.")])
    assert evaluation["grounding"][0].sourceSupport == "unsupported"
    assert evaluation["policy"].decision == "REJECT"


def test_negation_mismatch_and_internal_numeric_conflict_reject():
    negated = card("Answer: Metformin does not reduce glucose.", "Metformin reduces glucose.")
    evaluation = evaluate_card(negated, [segment("s1", "Metformin reduces glucose.")])
    assert evaluation["grounding"][0].sourceSupport == "contradicted"
    assert evaluation["policy"].decision == "REJECT"

    conflicting = Card("c2", "What threshold applies?",
                       "Answer: Weight is less than 85%.\nStudy note: Weight is less than 15%.",
                       "production", "s1", "Page 1", "definition", "Recall threshold.", "Weight is less than 85%.")
    result = evaluate_card(conflicting, [segment("s1", "Weight is less than 85%.")])
    assert "INTERNAL_NUMERIC_CONTRADICTION" in {item.code for item in result["validations"]}
    assert result["policy"].decision == "REJECT"


def test_publication_policy_publish_sanitize_review_reject():
    source = segment("s1", "Metformin reduces hepatic glucose production. Lithium dose is 300 mg.")
    publish = evaluate_card(card("Answer: Metformin reduces hepatic glucose production.",
                                 "Metformin reduces hepatic glucose production."), [source])
    sanitize = evaluate_card(card("Answer: Metformin reduces hepatic glucose production.\nWhy it matters: It cures all disease.",
                                  "Metformin reduces hepatic glucose production."), [source])
    review = evaluate_card(Card("c3", "What is the lithium dose?", "Answer: Lithium dose is 300 mg.",
                                "production", "s1", "Page 1", "dose", "Recall dose.", "Lithium"), [source])
    reject = evaluate_card(card("Answer: Metformin increases hepatic glucose production.",
                                "Metformin reduces hepatic glucose production."), [source])
    assert [item["policy"].decision for item in (publish, sanitize, review, reject)] == [
        "PUBLISH", "SANITIZE", "REVIEW", "REJECT"
    ]
    assert sanitize["policy"].removedClaimIds


def test_numeric_range_and_qualifier_mismatches_are_not_grounded():
    range_result = evaluate_card(
        card("Answer: Treatment lasts 2-5 hours.", "Treatment lasts 2-4 hours."),
        [segment("s1", "Treatment lasts 2-4 hours.")],
    )
    qualifier_result = evaluate_card(
        card("Answer: Maintain approximately 1500 mg/day.", "Maintain 1500 mg/day."),
        [segment("s1", "Maintain 1500 mg/day.")],
    )
    assert range_result["grounding"][0].sourceSupport == "contradicted"
    assert qualifier_result["grounding"][0].sourceSupport == "contradicted"


def test_relation_conflict_increases_versus_reduces_is_rejected():
    result = evaluate_card(
        card("Answer: Metformin increases hepatic glucose production.",
             "Metformin reduces hepatic glucose production."),
        [segment("s1", "Metformin reduces hepatic glucose production.")],
    )
    assert result["grounding"][0].sourceSupport == "contradicted"
    assert result["policy"].decision == "REJECT"




def test_comparison_table_antonyms_do_not_create_false_contradiction():
    source = segment("s1", "Wernicke Korsakoff Acute Chronic Reversible Irreversible")
    result = evaluate_card(
        Card("c", "How do Wernicke and Korsakoff differ?",
             "Answer: Wernicke is acute and reversible; Korsakoff is chronic and irreversible.",
             "production", "s1", "Page 1", "comparison", "Compare syndromes.", source.text),
        [source],
    )
    assert all(item.sourceSupport != "contradicted" for item in result["grounding"])


def test_negation_in_example_does_not_reverse_definition():
    source = segment("s1", "Suppression: student decides not to think about illness; conscious forgetting.")
    result = evaluate_card(
        Card("c", "What is suppression?", "Answer: Suppression is conscious forgetting.",
             "production", "s1", "Page 1", "definition", "Define suppression.", source.text),
        [source],
    )
    assert all(item.sourceSupport != "contradicted" for item in result["grounding"])

def test_deck_validation_uses_source_position_and_has_valid_non_trigger():
    segments = [segment(f"s{index}", f"Distinct source statement {index}.") for index in range(1, 11)]
    concentrated = [
        Card(f"c{index}", f"Unique topic {index}?", f"Answer: Distinct response token{index}.",
             "production", "s1")
        for index in range(1, 11)
    ]
    distributed = [replace(item, segmentId=f"s{index}") for index, item in enumerate(concentrated, 1)]
    assert "START_CONCENTRATED_DECK" in {
        item.code for item in validate_deck(normalize_cards(concentrated), segments)
    }
    assert "START_CONCENTRATED_DECK" not in {
        item.code for item in validate_deck(normalize_cards(distributed), segments)
    }


def test_exact_and_near_duplicate_decks_are_detected():
    exact = [
        Card("exact-a", "What does metformin reduce?", "Metformin reduces hepatic glucose production.", "production"),
        Card("exact-b", "What does metformin reduce?", "Metformin reduces hepatic glucose production.", "production"),
    ]
    near = [
        Card("near-a", "What action does metformin take?", "It reduces hepatic glucose production.", "production"),
        Card("near-b", "What action does metformin take in the liver?", "It reduces hepatic glucose production.", "production"),
    ]
    for deck in (exact, near):
        assert "EXACT_OR_NEAR_DUPLICATE" in {
            item.code for item in validate_deck(normalize_cards(deck))
        }


def test_artifact_mismatch_is_rejected():
    first = {"hashes": {"sourceSha256": "a"}, "versions": {"policy": "1"}}
    assert_compatible_artifacts([first, first])
    second = {"hashes": {"sourceSha256": "b"}, "versions": {"policy": "1"}}
    try:
        assert_compatible_artifacts([first, second])
    except ValueError as error:
        assert "refusing to combine" in str(error)
    else:
        raise AssertionError("mismatch accepted")
