from services.card_benchmark.matching_v2 import (
    build_comparison_scope,
    build_pair,
    classify_pair,
    question_intent,
)
from services.card_benchmark.models import Card, Concept, SourceSpan


def concept(text, identifier="c1", importance="high"):
    span = SourceSpan("u", "src", 0, "Page 1", "Section", 0, len(text), text, "hash", "PROSE", 1.0, (), "s1")
    return Concept(identifier, text.split()[0], text, (span,), "Section", (), importance, "none", "other",
                   (), 1.0, 1.0, "reviewed", "test")


def card(identifier, question, answer, system):
    return Card(identifier, question, answer, system, "s1", "Page 1")


def test_true_match_and_deterministic_pair_construction():
    source = concept("Lithium toxicity causes coarse tremor.")
    left = card("p", "What tremor indicates lithium toxicity?", "Coarse tremor.", "production")
    right = card("q", "Which tremor is a sign of lithium toxicity?", "Coarse tremor.", "quizlet")
    first = build_pair(source, left, right)
    assert first == build_pair(source, left, right)
    assert first["adjudication"] == "SAME_CONCEPT"
    assert first["matchConfidence"] == "HIGH"


def test_same_disease_different_concept_and_related_hard_negative_rejected():
    source = concept("Schizophrenia positive symptoms include hallucinations.")
    indication = card("p", "What symptoms occur in schizophrenia?", "Hallucinations.", "production")
    treatment = card("q", "How is schizophrenia treated?", "Antipsychotics.", "quizlet")
    serotonin = card("s", "What causes serotonin syndrome?", "Serotonergic drugs.", "quizlet")
    assert classify_pair(source, indication, treatment) == "DIFFERENT_CONCEPT"
    assert classify_pair(source, indication, serotonin) == "DIFFERENT_CONCEPT"


def test_same_medication_different_property_rejected():
    source = concept("Lithium toxicity causes coarse tremor.")
    toxicity = card("p", "What indicates lithium toxicity?", "Coarse tremor.", "production")
    dose = card("q", "What is the lithium dose?", "300 mg.", "quizlet")
    assert question_intent(toxicity.question) != question_intent(dose.question)
    assert classify_pair(source, toxicity, dose) == "DIFFERENT_CONCEPT"


def test_limited_comparison_scope_uses_shared_capacity_not_thirty():
    concepts = [concept(f"Concept {index} fact.", f"c{index}", "critical" if index == 0 else "medium") for index in range(3)]
    matches = [{"conceptId": item.conceptId, "matchConfidence": "HIGH", "adjudication": "SAME_CONCEPT"} for item in concepts]
    scope = build_comparison_scope(matches, concepts)
    assert scope["status"] == "COMPARISON_SCOPE_LIMITED"
    assert scope["requiredComparisonCount"] == 3
    assert scope["legacyThirtyPairRuleApplied"] is False
