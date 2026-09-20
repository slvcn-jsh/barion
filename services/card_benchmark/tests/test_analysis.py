from services.card_benchmark.analysis import (
    analyze_system,
    audit_production_grounding,
    core_answer,
    duplicate_clusters,
    freeze_concepts,
)
from services.card_benchmark.models import Card, Segment


def test_inventory_is_source_only_and_metrics_are_deterministic():
    segment = Segment("seg-1", "Page 1", "Mechanism", "Metformin reduces hepatic glucose production and improves glucose control.", 0, 74)
    concepts = freeze_concepts([segment])
    cards = [Card("quizlet-001", "How does metformin alter hepatic glucose production?", "It reduces hepatic glucose production.", "quizlet")]
    first = analyze_system(cards, concepts, segment.text)
    second = analyze_system(cards, concepts, segment.text)
    assert first == second
    assert first[0]["cardCount"] == 1
    assert first[0]["conceptCoverageRate"] == 1.0
    assert first[0]["segmentCoverageRate"] == 0.0
    assert first[0]["meanGroundingScore"] > 0.7
    assert first[0]["meanStructuralComplianceScore"] is None
    assert "meanPedagogicalProxyScore" in first[0]
    assert "meanQualityScore" not in first[0]


def test_duplicate_detection_clusters_near_identical_cards():
    cards = [
        Card("a", "What is avolition?", "Lack of motivation.", "quizlet"),
        Card("b", "What is avolition?", "Lack of motivation.", "quizlet"),
        Card("c", "What is catatonia?", "Absence of movement.", "quizlet"),
    ]
    assert duplicate_clusters(cards) == [["a", "b"]]


def test_core_answer_excludes_structured_answer_boilerplate():
    answer = "Answer: Hyponatremia increases lithium toxicity.\nWhy it matters: Long explanation.\nStudy note: Recall it."
    assert core_answer(answer) == "Hyponatremia increases lithium toxicity."


def test_segment_aware_recall_finds_concept_despite_answer_boilerplate():
    segment = Segment("seg-1", "Page 1", "Lithium", "Hyponatremia increases lithium toxicity and needs monitoring.", 0, 59)
    concepts = freeze_concepts([segment])
    card = Card(
        "production-001",
        "How does hyponatremia affect lithium toxicity?",
        "Answer: Hyponatremia increases lithium toxicity.\nWhy it matters: Monitor carefully.\nStudy note: Keep sodium stable.",
        "production",
        segmentId="seg-1",
        evidenceText=segment.text,
        cardType="risk-factor",
        learningObjective="Explain sodium effects on lithium toxicity.",
    )
    summary, rows = analyze_system([card], concepts, segment.text)
    assert summary["conceptCoverageRate"] == 1.0
    assert summary["segmentCoverageRate"] == 1.0
    assert rows[0]["conceptTokenRecall"] >= 0.5


def test_grounding_audit_flags_claim_words_absent_from_cited_evidence():
    card = Card(
        "production-001", "What prevents progression?",
        "Answer: Prompt thiamine prevents irreversible memory loss.", "production",
        evidenceText="Alcoholism causes Vitamin B1 thiamine deficiency.",
    )
    summary, rows = audit_production_grounding([card])
    assert summary["cardsRequiringManualReview"] == 1
    assert rows[0]["manualReviewRequired"] is True
    assert "prevents" in rows[0]["unsupportedByCitedEvidenceTokens"]
    assert "prevents" in rows[0]["unsupportedByFullSegmentTokens"]
