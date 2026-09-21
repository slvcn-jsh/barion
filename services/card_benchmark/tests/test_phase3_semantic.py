from services.card_benchmark.models import Card, Concept
from services.card_benchmark.semantic_fixtures import run_semantic_fixtures
from services.card_benchmark.semantic_matching import pair_systems, score_concept_card


def concept(text, label="Concept", aliases=()):
    return Concept("concept-1", label, text, (), "Section", tuple(aliases), "high", "none", "other",
                   (), 1.0, 1.0, "reviewed", "test")


def test_calibrated_semantic_fixtures_have_no_false_results():
    summary, rows = run_semantic_fixtures()
    assert summary["passed"] is True
    assert summary["falsePositive"] == summary["falseNegative"] == 0
    assert all(row["expectedMatch"] == row["actualMatch"] for row in rows)


def test_numeric_and_relation_conflicts_veto_high_overlap():
    dose = score_concept_card(concept("Lithium dose is 300 mg daily."),
                              Card("dose", "What is lithium dose?", "Lithium dose is 300 g daily.", "production"))
    relation = score_concept_card(concept("Treatment decreases blood pressure."),
                                  Card("relation", "What does treatment do?", "Treatment increases blood pressure.", "production"))
    assert dose.score == 0 and dose.numericAgreement is False
    assert relation.score == 0 and relation.contradictionVeto is True


def test_cross_system_pair_requires_shared_source_concept():
    source = concept("Myocardial infarction causes death of heart muscle after interrupted blood flow.",
                     "Myocardial infarction", ("heart attack",))
    production = [Card("p1", "What happens in myocardial infarction?",
                       "Interrupted blood flow causes death of heart muscle.", "production")]
    quizlet = [Card("q1", "What happens during a heart attack?",
                    "Heart muscle dies after interrupted blood flow.", "quizlet")]
    matches = pair_systems(production, quizlet, [source])
    assert len(matches) == 1
    assert matches[0]["conceptId"] == source.conceptId
    assert matches[0]["matcherVersion"] == "1.0.0"
