from dataclasses import replace

from services.card_benchmark.coverage import evaluate_coverage
from services.card_benchmark.extraction import extract_structural_units, segment_pages
from services.card_benchmark.inventory import _heading_is_proposition, build_concept_inventory
from services.card_benchmark.models import Card, Page, StructuralUnit


def pages_and_units(texts):
    pages = [Page(f"Page {index + 1}", text, index, "source-test") for index, text in enumerate(texts)]
    segments = segment_pages(pages, "Source")
    return pages, extract_structural_units(pages, segments, "Source")


def test_structural_prose_list_table_comparison_and_numeric_handling():
    _pages, units = pages_and_units([
        "Treatment\nMetformin reduces hepatic glucose production.\n- Monitor renal function carefully.\n"
        "Drug  Dose plan\nLithium | 300 mg | monitor level\nWeight criterion is less than 85% of expected weight."
    ])
    types = {unit.structuralType for unit in units}
    assert {"HEADING", "PROSE", "LIST_ITEM", "TABLE_ROW", "COMPARISON_MATRIX", "NUMERIC_CRITERION"} <= types
    concepts = build_concept_inventory(units)
    assert concepts
    assert all(concept.sourceSpans for concept in concepts)
    for concept in concepts:
        span = concept.sourceSpans[0]
        assert _pages[span.pageIndex].text[span.startOffset:span.endOffset] == span.text
    numeric = next(concept for concept in concepts if "85%" in concept.atomicProposition)
    assert numeric.conceptType == "numeric_threshold"
    comparison = next(concept for concept in concepts if "Lithium" in concept.atomicProposition)
    assert comparison.sourceSpans[0].structuralType == "COMPARISON_MATRIX"
    assert "300 mg" in comparison.atomicProposition


def test_aliases_importance_risk_and_critical_identity_are_separate():
    _pages, units = pages_and_units([
        "Safety\nCardiopulmonary resuscitation (CPR) is an emergency action.\n"
        "Drug X is contraindicated in pregnancy because it can be fatal.\n"
        "Sodium is an essential electrolyte."
    ])
    concepts = build_concept_inventory(units)
    cpr = next(concept for concept in concepts if "CPR" in concept.atomicProposition)
    contraindication = next(concept for concept in concepts if "contraindicated" in concept.atomicProposition)
    assert {"CPR", "Cardiopulmonary resuscitation"} <= set(cpr.aliases)
    assert cpr.importance == "critical" and cpr.medicalRisk == "critical"
    assert contraindication.importance == "critical" and contraindication.medicalRisk == "critical"
    assert len({item.conceptId for item in concepts if item.importance == "critical"}) == 2


def test_inventory_stable_source_only_and_ambiguous_never_high_confidence():
    pages, units = pages_and_units(["Topic\nAspirin reduces platelet aggregation.", ""])
    ambiguous = replace(units[1], normalizedText="Drug has uncertain value", rawText="Drug has uncertain value",
                        warnings=("multi_column_ambiguity",), extractionConfidence=0.55,
                        structuralType="TABLE_ROW")
    first = build_concept_inventory([units[0], ambiguous])
    second = build_concept_inventory([units[0], ambiguous])
    cards = [Card("a", "Unrelated?", "Unrelated.", "quizlet")]
    reordered = list(reversed(cards))
    assert first == second
    assert [item.conceptId for item in first] == [item.conceptId for item in second]
    assert first == build_concept_inventory([units[0], ambiguous])
    assert evaluate_coverage(cards, first) == evaluate_coverage(reordered, first)
    uncertain = next(item for item in first if item.atomicProposition == "Drug has uncertain value")
    assert uncertain.inventoryReviewStatus == "uncertain"
    assert uncertain.extractionConfidence < 0.7
    assert pages[1].text == ""


def test_no_selectable_page_remains_diagnostic():
    _pages, units = pages_and_units(["Topic\nA valid source proposition exists.", ""])
    empty = units[-1]
    assert empty.structuralType == "UNKNOWN"
    assert "missing_selectable_text" in empty.warnings
    assert empty.extractionConfidence == 0.0



def test_heading_labels_are_excluded_but_sentence_like_headings_remain_concepts():
    assert not _heading_is_proposition("Safety")
    assert _heading_is_proposition("Sodium is essential")
    assert _heading_is_proposition("What causes toxicity?")

    _pages, units = pages_and_units(["Safety\nSodium is essential"])
    concepts = build_concept_inventory(units)
    propositions = {concept.atomicProposition for concept in concepts}
    assert "Safety" not in propositions
    assert "Sodium is essential" in propositions


def test_inventory_version_changes_stable_concept_identity():
    _pages, units = pages_and_units(["Topic\nAspirin reduces platelet aggregation."])
    first = build_concept_inventory(units, "2.0.0")
    next_version = build_concept_inventory(units, "2.0.1")
    assert [item.atomicProposition for item in first] == [item.atomicProposition for item in next_version]
    assert [item.conceptId for item in first] != [item.conceptId for item in next_version]
