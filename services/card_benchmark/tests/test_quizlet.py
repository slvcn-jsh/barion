from pathlib import Path

from services.card_benchmark.quizlet import parse_quizlet_pdf

ROOT = Path(__file__).resolve().parents[3]
PDF = ROOT / "tmp" / "card-benchmark" / "QUIZLET_OUTPUT.pdf"


def test_real_quizlet_pdf_has_exact_consecutive_non_empty_cards():
    if not PDF.exists():
        return
    cards = parse_quizlet_pdf(PDF)
    assert len(cards) == 183
    assert cards[0].cardId == "quizlet-001"
    assert cards[-1].cardId == "quizlet-183"
    assert all(card.question and card.answer for card in cards)


def test_real_quizlet_cross_page_cards_10_and_159():
    if not PDF.exists():
        return
    cards = {card.cardId: card for card in parse_quizlet_pdf(PDF)}
    assert "common side effects" in cards["quizlet-010"].question.lower()
    assert "dry mouth" in cards["quizlet-010"].answer.lower()
    assert "goal of the orientation" in cards["quizlet-159"].question.lower()
    assert "establish trust" in cards["quizlet-159"].answer.lower()
