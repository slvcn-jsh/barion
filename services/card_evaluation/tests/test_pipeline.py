from pathlib import Path

from services.card_evaluation.adapters.fixture import FixtureAuthorityAdapter
from services.card_evaluation.claims import classify_claim_type, extract_numeric_values, extract_text_claims
from services.card_evaluation.models import Card, Segment, SourceVerificationContext
from services.card_evaluation.pipeline import _authority_query, evaluate_once, evaluate_production_candidate
from services.card_evaluation.policy import decide_publication
from services.card_evaluation.verification import VerificationCoordinator
from services.source_span import resolve_source_span


FIXTURES = Path(__file__).parents[1] / "fixtures" / "authorities.json"


def source(text: str) -> Segment:
    return Segment("s1", "Page 1", "Topic", text, 0, len(text))


def candidate(
    answer: str,
    evidence: str,
    source_text: str,
    *,
    question: str = "What does metformin do?",
    card_type: str = "mechanism",
) -> Card:
    span = resolve_source_span(source_text, evidence).to_dict()
    return Card(
        "c1", question, answer, "production", "s1", "Page 1", card_type,
        "Recall the source-supported answer.", evidence, span,
    )


def evaluate(card: Card, source_text: str, verifier: VerificationCoordinator | None = None):
    return evaluate_production_candidate(card, [source(source_text)], verifier or VerificationCoordinator())


def test_safe_supported_claim_publishes():
    text = "Metformin reduces hepatic glucose production."
    _effective, result = evaluate(candidate(f"Answer: {text}", text, text), text)
    assert result["publicationDisposition"] == "PUBLISH"
    assert result["sourceClaimSupported"] == "supported"
    assert result["claimResults"][0]["sourceSupport"] == "supported_by_citation"


def test_exact_coordinates_do_not_create_semantic_support_and_unsupported_core_rejects():
    text = "Metformin reduces hepatic glucose production."
    _effective, result = evaluate(candidate("Answer: Metformin cures diabetes.", text, text), text)
    assert result["sourceSpan"]["status"] == "exact"
    assert result["sourceClaimSupported"] == "unsupported"
    assert result["publicationDisposition"] == "REJECT"


def test_unsupported_optional_content_is_sanitized_then_fully_reevaluated():
    text = "Metformin reduces hepatic glucose production."
    original = candidate(
        f"Answer: {text}\nWhy it matters: Metformin cures every disease.",
        text,
        text,
    )
    effective, result = evaluate(original, text)
    assert result["publicationDisposition"] == "PUBLISH"
    assert result["sanitization"]["initialDisposition"] == "SANITIZE"
    assert result["sanitization"]["finalDisposition"] == "PUBLISH"
    assert result["sanitization"]["reevaluated"] is True
    assert "cures every disease" not in effective.answer
    assert result["originalCandidate"]["answer"] == original.answer


def test_sanitized_candidate_that_fails_reevaluation_never_publishes():
    source_text = "Metformin reduces glucose. It improves insulin sensitivity."
    original = candidate(
        "Answer: Metformin reduces glucose.\nWhy it matters: Metformin cures every disease.",
        "It improves insulin sensitivity.",
        source_text,
    )
    _effective, result = evaluate(original, source_text)
    assert result["sanitization"]["initialDisposition"] == "SANITIZE"
    assert result["sanitization"]["finalDisposition"] == "REVIEW"
    assert result["publicationDisposition"] == "REVIEW"
    assert "SANITIZED_CARD_FAILED_REEVALUATION" in result["reasonCodes"]


def test_high_risk_required_verification_unavailable_is_review():
    text = "Lithium dose is 300 mg."
    card = candidate(f"Answer: {text}", text, text, question="What is the lithium dose?")
    _effective, result = evaluate(card, text)
    assert result["medicalRisk"] == "high"
    assert result["medicalVerificationStatus"] == "authority_unavailable"
    assert result["publicationDisposition"] == "REVIEW"


def test_distinct_temporal_doses_are_not_an_internal_contradiction():
    text = "Initial lithium dose is 300 mg daily. Later lithium dose is 600 mg daily."
    card = candidate(
        "Answer: Initial lithium dose is 300 mg daily.\nStudy note: Later lithium dose is 600 mg daily.",
        text,
        text,
        question="How does the lithium dose change?",
        card_type="dose",
    )

    _effective, result = evaluate(card, text)

    assert "INTERNAL_NUMERIC_CONTRADICTION" not in result["reasonCodes"]
    assert result["sourceClaimSupported"] == "supported"
    assert result["publicationDisposition"] == "REVIEW"


def test_same_numeric_role_with_different_values_remains_a_contradiction():
    text = "The initial lithium dose is 300 mg daily."
    card = candidate(
        "Answer: The initial lithium dose is 300 mg daily.\nStudy note: The initial lithium dose is 600 mg daily.",
        text,
        text,
        question="What is the initial lithium dose?",
        card_type="dose",
    )

    _effective, result = evaluate(card, text)

    assert "INTERNAL_NUMERIC_CONTRADICTION" in result["reasonCodes"]
    assert result["publicationDisposition"] == "REJECT"


def test_approximate_and_exact_same_value_are_not_an_internal_contradiction():
    text = "About 80% of patients improve."
    card = candidate(
        "Answer: About 80% of patients improve.\nStudy note: 80% of patients improve.",
        text,
        text,
        question="What proportion of patients improve?",
        card_type="clinical-finding",
    )

    evaluation = evaluate_once(card, [source(text)])

    assert "INTERNAL_NUMERIC_CONTRADICTION" not in {
        item.code for item in evaluation["validations"]
    }


def test_authority_conflict_is_review_not_source_rewrite():
    text = "Disulfiram may be administered at least 8 hours after the last alcohol intake."
    card = candidate(f"Answer: {text}", text, text, question="When may disulfiram be administered?")
    verifier = VerificationCoordinator([FixtureAuthorityAdapter(FIXTURES)])
    _effective, result = evaluate(card, text, verifier)
    assert result["sourceClaimSupported"] == "supported"
    assert result["medicalVerificationStatus"] == "conflict"
    assert result["publicationDisposition"] == "REVIEW"
    assert result["originalCandidate"]["answer"] == card.answer


def test_external_verification_never_creates_source_support():
    claim = "Disulfiram reactions may occur with alcohol up to 14 days after ingesting disulfiram."
    source_text = "Disulfiram may be administered after abstinence from alcohol."
    card = candidate(f"Answer: {claim}", source_text, source_text, question="How long may reactions occur?")
    verifier = VerificationCoordinator([FixtureAuthorityAdapter(FIXTURES)])
    evaluation = evaluate_once(card, [source(source_text)])
    extracted = evaluation["claims"][0]
    grounded = evaluation["grounding"][0]
    verification = verifier.verify(extracted, SourceVerificationContext(
        sourceClaim=extracted.claimText,
        sourceEvidence=source_text,
        sourceSupport=grounded.sourceSupport,
        sourceFidelity=grounded.sourceFidelity,
        authorityQuery="disulfiram",
    ))
    policy = decide_publication(
        evaluation["claims"], evaluation["grounding"], evaluation["validations"], [verification],
    )
    assert verification.verificationStatus == "verified"
    assert grounded.sourceSupport == "unsupported"
    assert policy.decision == "REJECT"


def test_ambiguous_and_stale_source_spans_remain_review():
    repeated = "Metformin reduces glucose. Metformin reduces glucose."
    ambiguous = candidate("Answer: Metformin reduces glucose.", "Metformin reduces glucose.", repeated)
    _effective, ambiguous_result = evaluate(ambiguous, repeated)
    assert ambiguous_result["sourceSpan"]["status"] == "ambiguous"
    assert ambiguous_result["publicationDisposition"] == "REVIEW"

    text = "Metformin reduces glucose."
    stale_span = resolve_source_span(text, text).to_dict()
    stale_span.update({"status": "stale-source", "startOffset": None, "endOffset": None, "sourceTextSha256": "0" * 64})
    stale = Card(
        "stale", "What does metformin do?", f"Answer: {text}", "production",
        "s1", "Page 1", "mechanism", "Recall the source-supported answer.", text, stale_span,
    )
    _effective, stale_result = evaluate(stale, text)
    assert stale_result["citationStatus"] == "stale"
    assert stale_result["publicationDisposition"] == "REVIEW"


def test_single_token_medication_answer_is_a_valid_factual_core_claim():
    text = "Metformin is first-line therapy."
    card = candidate("Answer: Metformin.", text, text, question="Which medication is first-line therapy?")
    _effective, result = evaluate(card, text)
    core_claims = [item for item in result["claimResults"] if item["field"] == "core_answer"]
    assert [item["claimText"] for item in core_claims] == ["Metformin"]
    assert result["publicationDisposition"] == "PUBLISH"


def test_later_source_contradiction_overrides_earlier_support():
    supporting = "Exercise increases strength."
    contradicting = "Exercise decreases strength."
    card = candidate(f"Answer: {supporting}", supporting, supporting)
    result = evaluate_once(card, [source(supporting), Segment("s2", "Page 2", "Topic", contradicting, 0, len(contradicting))])
    core = next(item for item in result["grounding"] if item.claimId in {
        claim.claimId for claim in result["claims"] if claim.location == "core_answer"
    })
    assert core.sourceSupport == "contradicted"
    assert core.contradictionEvidence


def test_unrelated_document_numbers_do_not_contradict_cited_subject():
    supporting = "Abstinence is 100% effective in preventing pregnancy."
    unrelated = "When used correctly and consistently, birth control pills are 99.5% effective."
    card = candidate(
        f"Answer: {supporting}",
        supporting,
        supporting,
        question="How effective is abstinence in preventing pregnancy?",
        card_type="definition",
    )
    result = evaluate_once(card, [source(supporting), Segment("s2", "Page 2", "Pills", unrelated, 0, len(unrelated))])
    core = next(item for item in result["grounding"] if item.claimId in {
        claim.claimId for claim in result["claims"] if claim.location == "core_answer"
    })
    assert core.sourceSupport == "supported_by_citation"
    assert not core.contradictionEvidence


def test_unrelated_numbers_in_same_segment_do_not_contradict_supported_citation():
    supporting = "Abstinence is 100% effective in preventing pregnancy."
    same_segment = supporting + "\nWhen used correctly and consistently, 99.5% effective."
    card = candidate(
        "Answer: 100% effective.",
        same_segment,
        supporting,
        question="What is the effectiveness of abstinence in preventing pregnancy?",
        card_type="definition",
    )
    result = evaluate_once(card, [Segment("s1", "Page 1", "Methods", same_segment, 0, len(same_segment))])
    core = next(item for item in result["grounding"] if item.claimId in {
        claim.claimId for claim in result["claims"] if claim.location == "core_answer"
    })
    assert core.sourceSupport == "supported_by_citation"
    assert not core.contradictionEvidence


def test_contraindication_list_agrees_with_prohibition_wording():
    text = "Depo-Provera should not be used if blood clots, liver disease, or breast cancer are present."
    card = candidate(
        "Answer: Blood clots, liver disease, or breast cancer.",
        text,
        text,
        question="Which conditions contraindicate Depo-Provera?",
        card_type="contraindication",
    )
    _effective, result = evaluate(card, text)
    core = next(item for item in result["claimResults"] if item["field"] == "core_answer")
    assert core["sourceSupport"] == "supported_by_citation"
    assert result["publicationDisposition"] == "PUBLISH"


def test_document_mechanics_question_is_rejected_as_low_educational_value():
    text = "The atrium receives blood."
    card = candidate(
        "Answer: The.",
        text,
        text,
        question="Which word begins this sentence?",
        card_type="definition",
    )

    _effective, result = evaluate(card, text)

    assert result["publicationDisposition"] == "REJECT"
    assert "LOW_EDUCATIONAL_VALUE" in result["reasonCodes"]
    assert "LOW_EDUCATIONAL_VALUE" in result["validationCodes"]


def test_single_token_anatomy_answer_remains_publishable():
    text = "The atrium receives blood."
    card = candidate(
        "Answer: Atrium.",
        text,
        text,
        question="Which cardiac chamber receives blood?",
        card_type="anatomy",
    )

    _effective, result = evaluate(card, text)

    assert result["publicationDisposition"] == "PUBLISH"
    assert "LOW_EDUCATIONAL_VALUE" not in result["reasonCodes"]


def test_first_word_can_be_a_legitimate_developmental_learning_target():
    text = "A child's first word is often mama."
    card = candidate(
        "Answer: Mama.",
        text,
        text,
        question="What is a child's first word often?",
        card_type="developmental-milestone",
    )

    _effective, result = evaluate(card, text)

    assert result["publicationDisposition"] == "PUBLISH"
    assert "LOW_EDUCATIONAL_VALUE" not in result["reasonCodes"]


def test_section_can_name_a_legitimate_anatomy_learning_target():
    text = "The proximal tubule reabsorbs most filtered glucose."
    card = candidate(
        "Answer: Proximal tubule.",
        text,
        text,
        question="Which section of the nephron reabsorbs most filtered glucose?",
        card_type="anatomy",
    )

    _effective, result = evaluate(card, text)

    assert result["publicationDisposition"] == "PUBLISH"
    assert "LOW_EDUCATIONAL_VALUE" not in result["reasonCodes"]


def test_approximate_range_is_supported_by_exact_source_range():
    text = "80-90% of sexually active women not using birth control will become pregnant within one year."
    card = candidate(
        "Answer: Approximately 80-90% will become pregnant within one year.",
        text,
        text,
        question="What percentage will become pregnant within one year?",
        card_type="risk-factor",
    )
    _effective, result = evaluate(card, text)
    core = next(item for item in result["claimResults"] if item["field"] == "core_answer")
    assert core["sourceSupport"] == "supported_by_citation"
    assert result["publicationDisposition"] == "PUBLISH"


def test_cached_verification_rebinds_to_current_claim_identity():
    verifier = VerificationCoordinator([FixtureAuthorityAdapter(FIXTURES)])
    claim_text = "Patients taking lithium should maintain adequate salt and fluid intake."
    first = extract_text_claims("card-a", "core_answer", claim_text)[0]
    second = extract_text_claims("card-b", "core_answer", claim_text)[0]
    context = SourceVerificationContext(claim_text, claim_text, "supported_by_citation", "fully_grounded", "lithium")
    first_result = verifier.verify(first, context)
    second_result = verifier.verify(second, context)
    assert first_result.claimId == first.claimId
    assert second_result.claimId == second.claimId
    assert second_result.fromCache is True


def test_question_answer_vocabulary_mismatch_does_not_force_review():
    text = "Beta blockers reduce mortality."
    card = candidate("Answer: Beta blockers.", text, text, question="Which medication classes reduce mortality?")
    _effective, result = evaluate(card, text)
    assert "QUESTION_ANSWER_ENTITY_MISMATCH" not in result["reasonCodes"]
    assert result["publicationDisposition"] == "PUBLISH"


def test_yes_no_question_is_not_treated_as_an_asserted_claim():
    text = 'You may have heard that "You cannot get pregnant the first time." This is a myth.'
    card = candidate(
        "Answer: No, that statement is a myth.",
        text,
        text,
        question="Is it true that a woman cannot get pregnant the first time?",
        card_type="clinical-finding",
    )
    result = evaluate_once(card, [source(text)])
    assert all(claim.location != "question" for claim in result["claims"])


def test_medication_authority_query_extracts_lithium_not_leading_stopword():
    claim = extract_text_claims("card", "core_answer", "The recommended dose of lithium is 300 mg")[0]
    assert _authority_query(claim) == "lithium"


def test_compound_lab_units_are_not_truncated_to_dose_units():
    cases = {
        "126 mg/dL": "mg/dl",
        "5 mg/L": "mg/l",
        "2 mmol/L": "mmol/l",
        "4 mEq/L": "meq/l",
        "10 mcg/mL": "mcg/ml",
        "300 mg": "mg",
        "2 g": "g",
        "25 mcg": "mcg",
    }
    for text, expected_unit in cases.items():
        values = extract_numeric_values(text)
        assert [value.unit for value in values] == [expected_unit]
    assert classify_claim_type("Glucose is 126 mg/dL", "core_answer", extract_numeric_values("126 mg/dL")) == "lab_value"


def test_expired_verification_deadline_holds_high_risk_claim_for_review():
    class NeverCalledAdapter:
        id = "never-called"
        version = "1.0.0"

        def supports(self, _claim, _route, _context):
            return True

        def verify_claim(self, *_args, **_kwargs):
            raise AssertionError("expired request budget must prevent authority call")

    text = "Lithium dose is 300 mg."
    verifier = VerificationCoordinator([NeverCalledAdapter()], clock=lambda: 10.0)
    _effective, result = evaluate_production_candidate(
        candidate(f"Answer: {text}", text, text, question="What is the lithium dose?"),
        [source(text)],
        verifier,
        verification_deadline=9.0,
    )
    assert result["medicalVerificationStatus"] == "authority_unavailable"
    assert result["publicationDisposition"] == "REVIEW"


def test_markdown_bold_structured_answer_labels_are_parsed_and_published():
    text = "Metformin reduces hepatic glucose production. It is first-line therapy for type 2 diabetes."
    raw_answer = (
        "**Answer:** Metformin reduces hepatic glucose production.\n"
        "**Why it matters:** It is first-line therapy for type 2 diabetes.\n"
        "**Study note:** High yield diabetes mechanism."
    )
    card = candidate(raw_answer, text, text)
    _effective, result = evaluate(card, text)
    assert result["publicationDisposition"] in {"PUBLISH", "SANITIZE"}
    core_claims = [item for item in result["claimResults"] if item["field"] == "core_answer"]
    assert any("reduces hepatic glucose production" in item["claimText"] for item in core_claims)
