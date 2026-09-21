from services.card_benchmark.coverage import evaluate_coverage
from services.card_benchmark.extraction import extract_structural_units, segment_pages
from services.card_benchmark.inventory import build_concept_inventory
from services.card_benchmark.models import Card, Page


def inventory(texts):
    pages = [Page(f"Page {index + 1}", text, index, "source-coverage") for index, text in enumerate(texts)]
    segments = segment_pages(pages, "Source")
    concepts = build_concept_inventory(extract_structural_units(pages, segments, "Source"))
    return concepts


def card(identifier, answer, card_type="basic"):
    return Card(identifier, f"What source fact applies to {answer.split()[0]}?", answer, "production", cardType=card_type)


def test_weighted_section_page_position_and_zero_critical_coverage():
    concepts = inventory([
        "Safety\nDrug X is contraindicated in pregnancy because it can be fatal.",
        "Mechanism\nMetformin reduces hepatic glucose production.",
        "Details\nThe blue package is an incidental example."
    ])
    cards = [card("m", "Metformin reduces hepatic glucose production.", "mechanism")]
    result = evaluate_coverage(cards, concepts, 3)
    assert 0 < result["sourceCoverage"] < 1
    assert result["criticalConceptCoverage"] == 0
    assert result["coverageMap"]["sections"]["Safety"]["status"] == "zero coverage"
    assert result["pageCoverage"]["Page 2"] == 1.0
    assert result["sourcePositionDistribution"]["eligibleConcepts"] != result["sourcePositionDistribution"]["coveredByCards"]
    assert 0 <= result["sourcePositionDistribution"]["jensenShannonDivergence"] <= 1


def test_duplicate_cards_cannot_raise_coverage_or_count_concept_twice():
    concepts = inventory(["Mechanism\nMetformin reduces hepatic glucose production."])
    one = [card("one", "Metformin reduces hepatic glucose production.", "mechanism")]
    duplicates = one + [card("two", "Metformin reduces hepatic glucose production.", "mechanism")]
    first = evaluate_coverage(one, concepts, 1)
    second = evaluate_coverage(duplicates, concepts, 1)
    assert first["sourceCoverage"] == second["sourceCoverage"] == 1.0
    assert first["coveredConceptCount"] == second["coveredConceptCount"] == 1
    assert len(second["conceptToCardIds"][concepts[0].conceptId]) == 2
    assert second["duplicateRate"] == 0.5


def test_few_valid_concepts_and_deck_reordering_are_deterministic():
    concepts = inventory(["Topic\nMercury circles the sun."])
    cards = [card("a", "Mercury circles the sun."), card("b", "Unrelated filler response.")]
    first = evaluate_coverage(cards, concepts, 1)
    second = evaluate_coverage(list(reversed(cards)), concepts, 1)
    assert first["coveredConceptIds"] == second["coveredConceptIds"]
    assert first["sourceCoverage"] == second["sourceCoverage"] == 1.0
    assert first["eligibleConceptCount"] == 1


def test_numeric_disagreement_does_not_cover_numeric_criterion():
    concepts = inventory(["Criteria\nBody weight is less than 85% of expected weight."])
    result = evaluate_coverage([card("wrong", "Body weight is less than 15% of expected weight.")], concepts, 1)
    assert result["coveredConceptCount"] == 0
    assert result["sourceCoverage"] == 0.0


def test_numeric_units_must_agree():
    concepts = inventory(["Dose\nLithium dose is 300 mg daily."])
    result = evaluate_coverage([card("wrong-unit", "Lithium dose is 300 g daily.")], concepts, 1)
    assert result["coveredConceptCount"] == 0


def test_duplicate_cards_do_not_skew_position_balance_and_reduce_diversity():
    concepts = inventory([
        "Mechanism\nMetformin reduces hepatic glucose production.",
        "Safety\nDrug X is contraindicated in pregnancy because it can be fatal.",
    ])
    metformin = card("one", "Metformin reduces hepatic glucose production.", "mechanism")
    one = evaluate_coverage([metformin], concepts, 2)
    duplicated = evaluate_coverage([
        metformin,
        card("two", "Metformin reduces hepatic glucose production.", "mechanism"),
    ], concepts, 2)
    assert one["sourcePositionDistribution"] == duplicated["sourcePositionDistribution"]
    assert one["conceptDiversity"] == 1.0
    assert duplicated["conceptDiversity"] == 0.5

