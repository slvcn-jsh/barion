from __future__ import annotations

import re

from .io_utils import sha256_text
from .models import Claim, NormalizedCard, NumericValue, RiskLevel, SourceLocation

CLAIM_EXTRACTOR_VERSION = "1.0.0"
_NUMBER = re.compile(
    r"(?P<qualifier><=|>=|<|>|~|about\s+|approximately\s+|less\s+than\s+|more\s+than\s+)?"
    r"(?P<start>\d+(?:\.\d+)?)\s*(?:(?:-|–|to)\s*(?P<end>\d+(?:\.\d+)?))?\s*"
    r"(?P<unit>%|mg/day|mg|mcg|g|mEq/L|mmol/L|mg/dL|hours?|hrs?|minutes?|days?|weeks?|months?|years?|y/o|times?\s+(?:daily|per\s+day)|x/day)?",
    re.I,
)
_ABBREVIATIONS = ("e.g.", "i.e.", "vs.", "dr.", "mr.", "mrs.", "mg.", "approx.")
_VERB = re.compile(r"\b(is|are|was|were|has|have|causes?|increases?|decreases?|reduces?|prevents?|requires?|includes?|means?|indicates?|must|should|wait|avoid|start|stop|discontinue|maintain|monitor|administer)\b", re.I)
_NEGATION = re.compile(r"\b(no|not|never|neither|without|doesn't|does not|isn't|is not|cannot|can't|avoid)\b", re.I)
_MEDICAL_HIGH = re.compile(r"\b(dose|dosage|medication|drug|alcohol|interaction|toxicity|toxic|serum|lab|pregnan|pediatric|child|infant|emergency|airway|breathing|circulation|start|initiat|stop|discontinue|administer|wait|mg|mcg|meq|mmol)\b", re.I)
_MEDICAL_CRITICAL = re.compile(r"\b(emergency|airway|breathing|circulation|fatal|life-threatening|resuscitat|anaphylaxis|overdose)\b", re.I)


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
            removable=location in {"explanation", "study_note", "learning_objective"},
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
    if units & {"meq/l", "mmol/l", "mg/dl"}: return "lab_value"
    if numbers: return "numeric"
    if re.search(r"\b(should|must|avoid|start|stop|discontinue|administer|monitor)\b", lower): return "instruction"
    if re.search(r"\b(is|are|means|defined as|refers to)\b", lower): return "definition"
    return "factual"


def classify_risk(text: str, claim_type: str, numbers: list[NumericValue]) -> RiskLevel:
    if _MEDICAL_CRITICAL.search(text): return "critical"
    if claim_type in {"medication_timing", "dose", "lab_value", "age_threshold"} or _MEDICAL_HIGH.search(text): return "high"
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
    return bool(_VERB.search(text) or _NUMBER.search(text) or (location == "core_answer" and len(text.split()) >= 2) or len(text.split()) >= 4)


def _subject_relation(text: str) -> tuple[str, str]:
    match = _VERB.search(text)
    return (text[:match.start()].strip(" ,"), match.group(0).lower()) if match else ("", "")


def _normalize_unit(unit: str) -> str:
    value = re.sub(r"\s+", " ", unit.strip().lower())
    aliases = {"hours": "hour", "hrs": "hour", "hr": "hour", "minutes": "minute", "days": "day", "weeks": "week", "months": "month", "years": "year", "times daily": "frequency", "times per day": "frequency"}
    return aliases.get(value, value)
