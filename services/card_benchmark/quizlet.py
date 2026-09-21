from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path

import pymupdf

from .models import Card

CARD_START = re.compile(r"^(\d{1,3})\.\s*(.*)$")


@dataclass(slots=True)
class _MutableCard:
    number: int
    question_parts: list[str] = field(default_factory=list)
    answer_parts: list[str] = field(default_factory=list)


def parse_quizlet_pdf(path: Path, expected_count: int | None = 183) -> list[Card]:
    """Reconstruct numbered two-column cards, including page continuations."""
    document = pymupdf.open(path)
    cards: dict[int, _MutableCard] = {}
    active_number: int | None = None
    try:
        for page in document:
            initial_active = active_number
            left, right = _column_lines(page)
            starts: list[tuple[float, int]] = []
            for y, text in left:
                match = CARD_START.match(text)
                if match:
                    number = int(match.group(1))
                    if number in cards:
                        raise ValueError(f"Duplicate Quizlet card number {number}.")
                    cards[number] = _MutableCard(number)
                    active_number = number
                    starts.append((y, number))
                    if match.group(2).strip():
                        cards[number].question_parts.append(match.group(2).strip())
                elif active_number is not None:
                    cards[active_number].question_parts.append(text)

            for y, text in right:
                owner = initial_active
                for start_y, number in starts:
                    if start_y <= y + 2:
                        owner = number
                    else:
                        break
                if owner is not None:
                    cards[owner].answer_parts.append(text)
    finally:
        document.close()

    numbers = sorted(cards)
    if expected_count is not None and numbers != list(range(1, expected_count + 1)):
        missing = sorted(set(range(1, expected_count + 1)) - set(numbers))
        raise ValueError(f"Expected consecutive cards 1-{expected_count}; found {len(numbers)}. Missing: {missing}.")

    output = [Card(
        cardId=f"quizlet-{number:03d}",
        question=_join_wrapped(cards[number].question_parts),
        answer=_join_wrapped(cards[number].answer_parts),
        system="quizlet",
    ) for number in numbers]
    empty = [card.cardId for card in output if not card.question or not card.answer]
    if empty:
        raise ValueError(f"Quizlet cards contain empty sides: {', '.join(empty)}.")
    return output


def _column_lines(page: pymupdf.Page) -> tuple[list[tuple[float, str]], list[tuple[float, str]]]:
    midpoint = page.rect.width * 0.5637  # ~345pt on 612pt Quizlet pages.
    columns: list[list[tuple[float, str]]] = [[], []]
    grouped: dict[tuple[int, int, int], list[tuple[float, float, str]]] = {}
    for x0, y0, _x1, _y1, text, block, line, _word in page.get_text("words", sort=False):
        if y0 < 74 or y0 >= page.rect.height - 42:
            continue
        column = 0 if x0 < midpoint else 1
        grouped.setdefault((column, block, line), []).append((x0, y0, text))
    line_rows: list[tuple[int, float, str]] = []
    for (column, _block, _line), words in grouped.items():
        ordered = " ".join(text for _x, _y, text in sorted(words)).strip()
        if ordered:
            line_rows.append((column, min(word[1] for word in words), ordered))
    for column, y, text in sorted(line_rows, key=lambda row: (row[1], row[0])):
        columns[column].append((y, text))
    return columns[0], columns[1]


def _join_wrapped(parts: list[str]) -> str:
    result = ""
    for part in parts:
        clean = " ".join(part.split())
        if not clean:
            continue
        if result.endswith("-") and clean[:1].islower():
            result = result[:-1] + clean
        else:
            result = f"{result} {clean}".strip()
    return result
