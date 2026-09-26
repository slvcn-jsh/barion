from __future__ import annotations

import re

from .models import Card, NormalizedCard, SourceReference
from .text import canonical_json, sha256_text

NORMALIZATION_VERSION = "1.0.0"
_LABEL = re.compile(r"(?im)^\s*(?:\d+[.)]\s*)?(?:[-•*]\s*)?(?:\*{1,2})?\s*(answer|why\s+it\s+matters|study\s+note)\s*(?:\*{1,2})?\s*[:\-]\s*(?:\*{1,2})?\s*")


def normalize_card(card: Card) -> NormalizedCard:
    warnings: list[str] = []
    core, explanation, note = _parse_answer(card.answer, card.system, warnings)
    references: tuple[SourceReference, ...] = ()
    if card.segmentId or card.evidenceText:
        span = card.evidenceSpan or {}
        references = (SourceReference(
            card.segmentId, card.locator, card.evidenceText,
            span.get("startOffset"), span.get("endOffset"), span.get("version", ""),
            span.get("offsetEncoding", ""), span.get("boundaryConvention", ""),
            span.get("evidenceTextSha256", ""), span.get("sourceTextSha256", ""),
            span.get("status", "legacy-unresolved"), span.get("matchCount", 0),
        ),)
    raw_hash = sha256_text(canonical_json({
        "cardId": card.cardId, "system": card.system, "question": card.question,
        "answer": card.answer, "segmentId": card.segmentId, "locator": card.locator,
        "cardType": card.cardType, "learningObjective": card.learningObjective,
        "evidenceText": card.evidenceText,
    }))
    return NormalizedCard(
        cardId=card.cardId, system=card.system, question=_clean(card.question),
        coreAnswer=core, explanation=explanation, studyNote=note,
        learningObjective=_clean(card.learningObjective), cardType=_clean(card.cardType),
        sourceReferences=references, rawInputHash=raw_hash,
        normalizationWarnings=tuple(warnings), rawQuestion=card.question, rawAnswer=card.answer,
    )


def normalize_cards(cards: list[Card]) -> list[NormalizedCard]:
    return [normalize_card(card) for card in cards]


def build_answer(core: str, explanation: str = "", study_note: str = "") -> str:
    fields = [("Answer", core), ("Why it matters", explanation), ("Study note", study_note)]
    return "\n".join(f"{label}: {value}" for label, value in fields if value.strip())


def _parse_answer(answer: str, system: str, warnings: list[str]) -> tuple[str, str, str]:
    raw = answer.strip()
    if system == "quizlet":
        return _clean(raw), "", ""
    matches = list(_LABEL.finditer(raw))
    if not matches:
        warnings.append("MONOLITHIC_ANSWER_LABELS_MISSING")
        return _clean(raw), "", ""
    values: dict[str, str] = {}
    seen: set[str] = set()
    if raw[:matches[0].start()].strip():
        warnings.append("TEXT_BEFORE_FIRST_ANSWER_LABEL")
    for index, match in enumerate(matches):
        name = re.sub(r"\s+", " ", match.group(1).lower())
        end = matches[index + 1].start() if index + 1 < len(matches) else len(raw)
        value = _clean(raw[match.end():end])
        if name in seen:
            warnings.append(f"DUPLICATE_{name.upper().replace(' ', '_')}_LABEL")
            continue
        seen.add(name)
        values[name] = value
    if "answer" not in values or not values.get("answer"):
        warnings.append("CORE_ANSWER_MISSING")
    return values.get("answer", ""), values.get("why it matters", ""), values.get("study note", "")


def _clean(value: str) -> str:
    cleaned = re.sub(r"\s+", " ", value).strip()
    return re.sub(r"^[\s*_]+|[\s*_]+$", "", cleaned).strip()
