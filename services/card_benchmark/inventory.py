from __future__ import annotations

import re
from dataclasses import replace

from .io_utils import sha256_text
from .models import Concept, SourceSpan, StructuralUnit

INVENTORY_VERSION = "2.0.0"
_SENTENCE = re.compile(r"(?<=[.!?])\s+(?=[A-Z0-9])")
_LIST_PREFIX = re.compile(r"^\s*(?:[-*•▪]|\d+[.)])\s+")
_DEFINITION = re.compile(r"^(.{2,100}?)\s+(?:is|are|means|refers to|is defined as|are defined as)\s+(.+)$", re.I)
_ALIAS = re.compile(r"\b([A-Z][A-Za-z0-9 /-]{2,60}?)\s*\(([^()]{2,50})\)")
_NUMERIC = re.compile(r"\b\d+(?:\.\d+)?(?:\s*[-–]\s*\d+(?:\.\d+)?)?\s*(?:%|mg|mcg|g|kg|m[lL]|mEq/L|mmHg|hours?|days?|weeks?|months?|years?)\b", re.I)


def build_concept_inventory(units: list[StructuralUnit], inventory_version: str = INVENTORY_VERSION) -> list[Concept]:
    """Freeze source-only atomic concepts. No card/deck input is accepted by design."""
    candidates: list[Concept] = []
    for unit in units:
        if not unit.normalizedText or unit.structuralType == "UNKNOWN":
            continue
        if unit.structuralType == "HEADING" and not _heading_is_proposition(unit.normalizedText):
            continue
        for proposition, local_start, local_end in _propositions(unit):
            clean = _normalize(proposition)
            if not _eligible(clean):
                continue
            span = SourceSpan(
                structuralUnitId=unit.structuralUnitId, sourceArtifactId=unit.sourceArtifactId,
                pageIndex=unit.pageIndex, locator=unit.locator, sectionPath=unit.sectionPath,
                startOffset=unit.startOffset + local_start, endOffset=unit.startOffset + local_end,
                text=proposition, contentHash=sha256_text(_normalize(proposition)),
                structuralType=unit.structuralType, extractionConfidence=unit.extractionConfidence,
                warnings=unit.warnings, segmentId=unit.segmentId,
            )
            concept_type = _concept_type(clean, unit.structuralType)
            importance, importance_confidence = _importance(clean, concept_type)
            risk = _medical_risk(clean, concept_type)
            identity = f"{inventory_version}\0{unit.sourceArtifactId}\0{_identity_text(clean)}\0{unit.pageIndex}:{span.startOffset}:{span.endOffset}"
            uncertain = unit.extractionConfidence < 0.7 or bool(unit.warnings)
            candidates.append(Concept(
                conceptId=f"concept-{sha256_text(identity)[:20]}", canonicalLabel=_label(clean),
                atomicProposition=clean, sourceSpans=(span,), section=unit.sectionPath,
                aliases=_aliases(clean), importance=importance, medicalRisk=risk, conceptType=concept_type,
                prerequisiteIds=(), extractionConfidence=unit.extractionConfidence,
                importanceConfidence=importance_confidence,
                inventoryReviewStatus="uncertain" if uncertain else "deterministic",
                inventoryVersion=inventory_version, lineage=(unit.structuralUnitId,),
            ))
    return _merge_equivalent(candidates)


def _propositions(unit: StructuralUnit) -> list[tuple[str, int, int]]:
    raw = unit.rawText
    prefix = _LIST_PREFIX.match(raw)
    base_offset = prefix.end() if prefix else len(raw) - len(raw.lstrip())
    text = raw[base_offset:].rstrip()
    if unit.structuralType in {"TABLE_ROW", "TABLE_CELL_RELATION", "COMPARISON_MATRIX"}:
        return [(text, base_offset, base_offset + len(text))]
    parts = []
    cursor = 0
    for sentence in _SENTENCE.split(text):
        sentence = sentence.strip()
        start = text.find(sentence, cursor)
        start = start if start >= 0 else cursor
        cursor = start + len(sentence)
        parts.append((sentence, base_offset + start, base_offset + cursor))
    return parts


def _normalize(text: str) -> str:
    return " ".join(text.strip(" •▪-\t").split())


def _identity_text(text: str) -> str:
    return re.sub(r"[^a-z0-9.%]+", " ", text.lower()).strip()


def _eligible(text: str) -> bool:
    words = re.findall(r"[A-Za-z0-9]+", text)
    return 3 <= len(words) and 12 <= len(text) <= 500 and bool(re.search(r"[A-Za-z]", text))


def _aliases(text: str) -> tuple[str, ...]:
    values: set[str] = set()
    for long_name, short_name in _ALIAS.findall(text):
        values.update({_normalize(long_name), _normalize(short_name)})
    return tuple(sorted(values, key=str.casefold))


def _concept_type(text: str, structural_type: str) -> str:
    lower = text.lower()
    if structural_type == "NUMERIC_CRITERION" or (_NUMERIC.search(text) and re.search(r"criterion|threshold|less than|greater than|at least|no more than", lower)):
        return "numeric_threshold"
    patterns = (
        ("emergency_action", r"\b(emergency|immediately|call 911|resuscitat|urgent)\b"),
        ("contraindication", r"\b(contraindicat|must not|do not use|avoid in|dangerous interaction)\b"),
        ("adverse_effect", r"\b(adverse|side effect|toxicity|toxic|complication)\b"),
        ("diagnostic_criterion", r"\b(diagnos|criterion|criteria|hallmark)\b"),
        ("medication_rule", r"\b(dose|dosage|administer|medication|drug|mg|mcg|mEq/L)\b"),
        ("treatment", r"\b(treat|therapy|management|first[- ]line|intervention)\b"),
        ("risk_factor", r"\b(risk factor|predispos|increases? risk)\b"),
        ("mechanism", r"\b(mechanism|inhibits?|blocks?|reduces?|increases?|stimulates?|causes?)\b"),
        ("comparison", r"\b(compared with|versus|whereas|unlike|difference between)\b"),
        ("clinical_finding", r"\b(symptom|sign|finding|presents?|manifestation)\b"),
        ("procedure", r"\b(procedure|steps?|perform|technique)\b"),
    )
    for concept_type, pattern in patterns:
        if re.search(pattern, lower):
            return concept_type
    if _DEFINITION.match(text):
        return "definition"
    return "other"


def _importance(text: str, concept_type: str) -> tuple[str, float]:
    lower = text.lower()
    if concept_type in {"emergency_action", "contraindication"} or re.search(r"\b(toxic level|fatal|life-threatening|dangerous interaction|safety threshold)\b", lower):
        return "critical", 0.9
    if concept_type in {"definition", "diagnostic_criterion", "mechanism"} or re.search(r"\b(hallmark|first[- ]line|major|key|essential)\b", lower):
        return "high", 0.8
    if re.search(r"\b(example|administrative|copyright|learning objective)\b", lower):
        return "low", 0.75
    return "medium", 0.6


def _medical_risk(text: str, concept_type: str) -> str:
    lower = text.lower()
    if concept_type == "emergency_action" or re.search(r"\b(fatal|life-threatening|resuscitat)\b", lower):
        return "critical"
    if concept_type == "contraindication" or re.search(r"\b(toxic|toxicity|dangerous interaction|overdose)\b", lower):
        return "high"
    if concept_type in {"medication_rule", "numeric_threshold", "diagnostic_criterion", "adverse_effect"}:
        return "moderate"
    if concept_type in {"treatment", "risk_factor", "clinical_finding", "procedure"}:
        return "low"
    return "none"


def _merge_equivalent(concepts: list[Concept]) -> list[Concept]:
    merged: dict[tuple[str, str], Concept] = {}
    for concept in concepts:
        key = (concept.section.casefold(), _identity_text(concept.atomicProposition))
        existing = merged.get(key)
        if existing is None:
            merged[key] = concept
            continue
        spans = tuple(sorted({*existing.sourceSpans, *concept.sourceSpans}, key=lambda span: (span.pageIndex, span.startOffset, span.endOffset)))
        aliases = tuple(sorted(set((*existing.aliases, *concept.aliases)), key=str.casefold))
        lineage = tuple(sorted(set((*existing.lineage, *concept.lineage))))
        merged[key] = replace(existing, sourceSpans=spans, aliases=aliases, lineage=lineage,
                              extractionConfidence=min(existing.extractionConfidence, concept.extractionConfidence))
    return sorted(merged.values(), key=lambda item: (item.sourceSpans[0].pageIndex, item.sourceSpans[0].startOffset, item.conceptId))



def _heading_is_proposition(text: str) -> bool:
    """Retain sentence-like headings; discard navigational labels."""
    normalized = _normalize(text)
    return bool(
        normalized.endswith((".", "!", "?"))
        or _DEFINITION.match(normalized)
        or re.search(
            r"\b(?:is|are|was|were|has|have|causes?|includes?|requires?|should|must|"
            r"reduces?|increases?|inhibits?|blocks?|stimulates?|presents?)\b",
            normalized,
            re.I,
        )
    )


def _label(text: str) -> str:
    definition = _DEFINITION.match(text)
    if definition:
        return definition.group(1).strip(" :")[:120]
    before = re.split(r"\b(?:is|are|causes?|includes?|requires?|should|must|has|have)\b", text, maxsplit=1, flags=re.I)[0]
    return (before.strip(" :") or text)[:120]
