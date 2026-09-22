from __future__ import annotations

import re

from .models import Claim, NormalizedCard, NumericValue, RiskLevel, SourceLocation
from .text import sha256_text

CLAIM_EXTRACTOR_VERSION = "1.2.0"
_NUMBER = re.compile(
    r"(?P<qualifier><=|>=|<|>|~|about\s+|approximately\s+|less\s+than\s+|more\s+than\s+)?"
    r"(?P<start>\d+(?:\.\d+)?)\s*(?:(?:-|–|to)\s*(?P<end>\d+(?:\.\d+)?))?\s*"
    r"(?P<unit>mg/day|mg/dL|mg/L|mcg/mL|mEq/L|mmol/L|times?\s+(?:daily|per\s+day)|x/day|hours?|hrs?|minutes?|days?|weeks?|months?|years?|y/o|mcg|mg|g|%)?"
    r"(?![A-Za-z/])",
    re.I,
)
_ABBREVIATIONS = ("e.g.", "i.e.", "vs.", "dr.", "mr.", "mrs.", "mg.", "approx.")
_VERB = re.compile(r"\b(is|are|was|were|has|have|causes?|increases?|decreases?|reduces?|prevents?|requires?|includes?|means?|indicates?|must|should|wait|avoid|start|stop|discontinue|maintain|monitor|administer)\b", re.I)
_NEGATION = re.compile(r"\b(no|not|never|neither|without|doesn't|does not|isn't|is not|cannot|can't|avoid)\b", re.I)
_MEDICAL_HIGH = re.compile(r"\b(dose|dosage|medication|drug|alcohol|interaction|toxicity|toxic|serum|lab|diagnostic|threshold|pregnan|pediatric|child|infant|emergency|airway|breathing|circulation|start|initiat|stop|discontinue|administer|wait|mg|mcg|meq|mmol|route)\b", re.I)
_MEDICAL_CRITICAL = re.compile(r"\b(emergency|airway|breathing|circulation|fatal|life-threatening|resuscitat|anaphylaxis|overdose)\b", re.I)
_NON_FACTUAL_CORE_TOKENS = {"answer", "unknown", "unclear", "unsure", "maybe", "thing", "stuff", "information"}


def extract_claims(card: NormalizedCard) -> tuple[list[Claim], dict[str, str]]:
    claims: list[Claim] = []
    states: dict[str, str] = {}
    fields: tuple[tuple[SourceLocation, str], ...] = (
        ("question", card.question), ("core_answer", card.coreAnswer),
        ("explanation", card.explanation), ("study_note", card.studyNote),
        ("learning_objective", card.learningObjective),
    )
    for location, text in fields:
        field_claims = extract_text_claims(card.cardId, location, text)
        claims.extend(field_claims)
        states[location] = "claims_extracted" if field_claims else "no_factual_claim"
    return claims, states


def extract_text_claims(card_id: str, location: SourceLocation, text: str) -> list[Claim]:
    if not text.strip():
        return []
    output: list[Claim] = []
    for start, _end, piece, ambiguous in _split_with_offsets(text):
        cleaned = piece.strip(" \t\r\n•▪-*;,.?")
        if len(cleaned) < 3 or not _is_factual(location, cleaned):
            continue
        leading = piece.find(cleaned)
        absolute_start = start + max(leading, 0)
        numbers = extract_numeric_values(cleaned)
        claim_type = classify_claim_type(cleaned, location, numbers)
        subject, relation = _subject_relation(cleaned)
        claim_id = f"clm-{sha256_text(f'{CLAIM_EXTRACTOR_VERSION}\0{card_id}\0{location}\0{absolute_start}\0{cleaned}')[:16]}"
        output.append(Claim(
            claimId=claim_id, cardId=card_id, location=location, claimText=cleaned,
            startOffset=absolute_start, endOffset=absolute_start + len(cleaned),
            claimType=claim_type, subject=subject, relation=relation,
            numericValues=tuple(numbers), negation=bool(_NEGATION.search(cleaned)),
            riskLevel=classify_risk(cleaned, claim_type, numbers),
            requiresVerification=location != "learning_objective" or bool(numbers),
            extractionAmbiguous=ambiguous, extractorVersion=CLAIM_EXTRACTOR_VERSION,
            removable=location in {"explanation", "study_note"},
        ))
    return output


def extract_numeric_values(text: str) -> list[NumericValue]:
    values: list[NumericValue] = []
    for match in _NUMBER.finditer(text):
        values.append(NumericValue(
            value=float(match.group("start")), raw=match.group(0).strip(),
            unit=_normalize_unit(match.group("unit") or ""),
            qualifier=(match.group("qualifier") or "").strip().lower(),
            endValue=float(match.group("end")) if match.group("end") else None,
        ))
    return values


def classify_claim_type(text: str, location: SourceLocation, numbers: list[NumericValue]) -> str:
    lower = text.lower()
    if location == "question": return "question_presupposition"
    units = {number.unit for number in numbers}
    if units & {"hour", "minute"} or re.search(r"\b(before|after|wait|timing)\b", lower): return "medication_timing"
    if units & {"day", "week", "month", "year"} or "duration" in lower: return "duration"
    if any("daily" in unit or unit == "frequency" for unit in units): return "frequency"
    if units & {"mg", "mg/day", "mcg", "g"}: return "dose"
    if "%" in units: return "percentage"
    if units & {"year", "y/o"}: return "age_threshold"
    if units & {"meq/l", "mmol/l", "mg/dl", "mg/l", "mcg/ml"}: return "lab_value"
    if numbers and re.search(r"\b(diagnostic|criterion|criteria|threshold)\b", lower): return "diagnostic_threshold"
    if numbers: return "numeric"
    if re.search(r"\b(should|must|avoid|start|stop|discontinue|administer|monitor)\b", lower): return "instruction"
    if re.search(r"\b(is|are|means|defined as|refers to)\b", lower): return "definition"
    return "factual"


def classify_risk(text: str, claim_type: str, numbers: list[NumericValue]) -> RiskLevel:
    if _MEDICAL_CRITICAL.search(text): return "critical"
    if claim_type in {"medication_timing", "dose", "lab_value", "age_threshold", "diagnostic_threshold"} or _MEDICAL_HIGH.search(text): return "high"
    if numbers or claim_type in {"percentage", "duration", "frequency", "instruction"}: return "moderate"
    return "low"


def _split_with_offsets(text: str) -> list[tuple[int, int, str, bool]]:
    protected = text
    replacements: dict[str, str] = {}
    for index, abbreviation in enumerate(_ABBREVIATIONS):
        token = f"__ABBR{index}__"
        protected = re.sub(re.escape(abbreviation), token, protected, flags=re.I)
        replacements[token] = abbreviation
    boundaries = [0]
    for match in re.finditer(r"(?:\r?\n\s*(?:[-*•▪]|\d+[.)])?\s*|;\s+|(?<!\d)[.!?](?!\d)\s+|\s+(?:but|however|whereas|while)\s+)", protected, re.I):
        boundaries.extend([match.start(), match.end()])
    boundaries.append(len(protected))
    pieces: list[tuple[int, int, str, bool]] = []
    for start, end in zip(boundaries[::2], boundaries[1::2]):
        if end <= start: continue
        piece = protected[start:end]
        for token, abbreviation in replacements.items(): piece = piece.replace(token, abbreviation)
        if piece.strip():
            ambiguous = len(re.findall(r"\b(?:and|or)\b", piece, re.I)) > 2 and len(_VERB.findall(piece)) > 2
            pieces.append((start, end, piece, ambiguous))
    return pieces or [(0, len(text), text, True)]


def _is_factual(location: SourceLocation, text: str) -> bool:
    if location == "question":
        return bool(_VERB.search(text) and not re.match(r"^(what|which|who|when|where|why|how)\b", text.lower()))
    if location == "learning_objective" and re.match(r"^(identify|explain|understand|recognize|recall|compare|contrast|define|differentiate)\b", text, re.I):
        return False
    if location == "core_answer" and _meaningful_single_entity(text):
        return True
    return bool(_VERB.search(text) or _NUMBER.search(text) or (location == "core_answer" and len(text.split()) >= 2) or len(text.split()) >= 4)


def _meaningful_single_entity(text: str) -> bool:
    tokens_found = re.findall(r"[A-Za-z][A-Za-z0-9'/-]*", text)
    return (
        len(tokens_found) == 1
        and len(tokens_found[0]) >= 3
        and tokens_found[0].lower() not in _NON_FACTUAL_CORE_TOKENS
    )


def _subject_relation(text: str) -> tuple[str, str]:
    match = _VERB.search(text)
    return (text[:match.start()].strip(" ,"), match.group(0).lower()) if match else ("", "")


def _normalize_unit(unit: str) -> str:
    value = re.sub(r"\s+", " ", unit.strip().lower())
    aliases = {"hours": "hour", "hrs": "hour", "hr": "hour", "minutes": "minute", "days": "day", "weeks": "week", "months": "month", "years": "year", "times daily": "frequency", "times per day": "frequency"}
    return aliases.get(value, value)
