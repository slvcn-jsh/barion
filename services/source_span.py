from __future__ import annotations

import hashlib
import re
import unicodedata
from dataclasses import asdict, dataclass
from typing import Literal

SOURCE_SPAN_VERSION = "1.0.0"
OFFSET_ENCODING = "utf16-code-units"
BOUNDARY_CONVENTION = "half-open"
ResolutionStatus = Literal[
    "exact", "normalized", "context-disambiguated", "ambiguous",
    "not-found", "invalid", "stale-source",
]


@dataclass(frozen=True, slots=True)
class SourceSpanResolution:
    version: str
    offsetEncoding: str
    boundaryConvention: str
    status: ResolutionStatus
    startOffset: int | None
    endOffset: int | None
    evidenceTextSha256: str
    sourceTextSha256: str
    matchCount: int

    def to_dict(self) -> dict[str, object]:
        return asdict(self)


def sha256_utf8(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def utf16_length(value: str) -> int:
    return len(value.encode("utf-16-le")) // 2


def slice_utf16(value: str, start: int, end: int) -> str | None:
    if not isinstance(start, int) or isinstance(start, bool) or not isinstance(end, int) or isinstance(end, bool):
        return None
    if start < 0 or end < start:
        return None
    encoded = value.encode("utf-16-le")
    if end * 2 > len(encoded):
        return None
    try:
        return encoded[start * 2:end * 2].decode("utf-16-le")
    except UnicodeDecodeError:
        return None


def resolve_source_span(
    source_text: str,
    evidence_text: str,
    *,
    context_before: str | None = None,
    context_after: str | None = None,
    expected_source_text_sha256: str | None = None,
) -> SourceSpanResolution:
    source_hash = sha256_utf8(source_text) if isinstance(source_text, str) else ""
    evidence_hash = sha256_utf8(evidence_text) if isinstance(evidence_text, str) else ""
    base = dict(
        version=SOURCE_SPAN_VERSION,
        offsetEncoding=OFFSET_ENCODING,
        boundaryConvention=BOUNDARY_CONVENTION,
        evidenceTextSha256=evidence_hash,
        sourceTextSha256=source_hash,
    )
    if not isinstance(source_text, str) or not isinstance(evidence_text, str) or not evidence_text:
        return SourceSpanResolution(status="invalid", startOffset=None, endOffset=None, matchCount=0, **base)
    if expected_source_text_sha256 is not None and expected_source_text_sha256 != source_hash:
        return SourceSpanResolution(status="stale-source", startOffset=None, endOffset=None, matchCount=0, **base)

    exact = _all_occurrences(source_text, evidence_text)
    if len(exact) == 1:
        return _resolved("exact", source_text, exact[0], exact[0] + len(evidence_text), 1, base)
    if len(exact) > 1:
        selected = _select_with_context(source_text, exact, len(evidence_text), context_before, context_after)
        if selected is not None:
            return _resolved("context-disambiguated", source_text, selected, selected + len(evidence_text), len(exact), base)
        return SourceSpanResolution(status="ambiguous", startOffset=None, endOffset=None, matchCount=len(exact), **base)

    normalized_source, starts, ends = _normalize_with_map(source_text)
    normalized_evidence, _, _ = _normalize_with_map(evidence_text)
    if not normalized_evidence:
        return SourceSpanResolution(status="invalid", startOffset=None, endOffset=None, matchCount=0, **base)
    matches = _all_occurrences(normalized_source, normalized_evidence)
    original_matches = [(starts[index], ends[index + len(normalized_evidence) - 1]) for index in matches]
    if len(original_matches) == 1:
        start, end = original_matches[0]
        return _resolved("normalized", source_text, start, end, 1, base)
    if len(original_matches) > 1:
        candidates = [start for start, _end in original_matches]
        widths = {start: end - start for start, end in original_matches}
        selected = _select_with_context(source_text, candidates, None, context_before, context_after, widths)
        if selected is not None:
            return _resolved("context-disambiguated", source_text, selected, selected + widths[selected], len(matches), base)
        return SourceSpanResolution(status="ambiguous", startOffset=None, endOffset=None, matchCount=len(matches), **base)

    layout_matches = _bounded_layout_matches(source_text, evidence_text)
    if len(layout_matches) == 1:
        start, end = layout_matches[0]
        return _resolved("normalized", source_text, start, end, 1, base)
    if len(layout_matches) > 1:
        candidates = [start for start, _end in layout_matches]
        widths = {start: end - start for start, end in layout_matches}
        selected = _select_with_context(source_text, candidates, None, context_before, context_after, widths)
        if selected is not None:
            return _resolved("context-disambiguated", source_text, selected, selected + widths[selected], len(layout_matches), base)
        return SourceSpanResolution(status="ambiguous", startOffset=None, endOffset=None, matchCount=len(layout_matches), **base)
    return SourceSpanResolution(status="not-found", startOffset=None, endOffset=None, matchCount=0, **base)


def _resolved(status: ResolutionStatus, source: str, start: int, end: int, count: int,
              base: dict[str, object]) -> SourceSpanResolution:
    return SourceSpanResolution(
        status=status, startOffset=utf16_length(source[:start]), endOffset=utf16_length(source[:end]),
        matchCount=count, **base,
    )


def _all_occurrences(text: str, needle: str) -> list[int]:
    output: list[int] = []
    offset = 0
    while needle and (found := text.find(needle, offset)) >= 0:
        output.append(found)
        offset = found + 1
    return output


def _select_with_context(source: str, starts: list[int], width: int | None,
                         before: str | None, after: str | None,
                         widths: dict[int, int] | None = None) -> int | None:
    if not before and not after:
        return None
    matches = []
    normalized_before = _normalize(before or "")
    normalized_after = _normalize(after or "")
    for start in starts:
        end = start + (width if width is not None else (widths or {})[start])
        prefix = _normalize(source[max(0, start - max(64, len(before or "") * 3)):start])
        suffix = _normalize(source[end:end + max(64, len(after or "") * 3)])
        if (not normalized_before or prefix.endswith(normalized_before)) and (
            not normalized_after or suffix.startswith(normalized_after)
        ):
            matches.append(start)
    return matches[0] if len(matches) == 1 else None


def _normalize(value: str) -> str:
    return _normalize_with_map(value)[0]


def _normalize_with_map(value: str) -> tuple[str, list[int], list[int]]:
    output: list[str] = []
    starts: list[int] = []
    ends: list[int] = []
    pending_space: tuple[int, int] | None = None
    for index, character in enumerate(value):
        normalized = unicodedata.normalize("NFKC", character)
        for item in normalized:
            if item.isspace():
                if output:
                    pending_space = (index, index + 1)
                continue
            if pending_space is not None:
                output.append(" "); starts.append(pending_space[0]); ends.append(pending_space[1])
                pending_space = None
            output.append(item); starts.append(index); ends.append(index + 1)
    return "".join(output), starts, ends


_MIN_LAYOUT_EVIDENCE_TOKENS = 8
_MAX_SKIPPED_TOKENS_PER_STEP = 12
_MAX_TOTAL_SKIPPED_TOKENS = 40
_UNSAFE_SKIPPED_TOKENS = {"no", "not", "never", "without", "cannot", "cant"}


def _bounded_layout_matches(source_text: str, evidence_text: str) -> list[tuple[int, int]]:
    """Match ordered source tokens split by bounded adjacent-table text."""
    source_tokens = _source_tokens(source_text)
    evidence_tokens = _source_tokens(evidence_text)
    if len(evidence_tokens) < _MIN_LAYOUT_EVIDENCE_TOKENS or len(source_tokens) < len(evidence_tokens):
        return []

    allowed_total_skipped = min(_MAX_TOTAL_SKIPPED_TOKENS, len(evidence_tokens) * 2)
    matches: list[tuple[int, int]] = []
    for start_index, start_token in enumerate(source_tokens):
        if start_token[0] != evidence_tokens[0][0]:
            continue
        source_index = start_index
        valid = True
        for evidence_token in evidence_tokens[1:]:
            next_index = _find_next_token(source_tokens, evidence_token[0], source_index + 1)
            if next_index < 0 or next_index - source_index - 1 > _MAX_SKIPPED_TOKENS_PER_STEP:
                valid = False
                break
            if any(_unsafe_skipped_token(token[0]) for token in source_tokens[source_index + 1:next_index]):
                valid = False
                break
            source_index = next_index
        total_skipped = source_index - start_index + 1 - len(evidence_tokens)
        if not valid or total_skipped < 1 or total_skipped > allowed_total_skipped:
            continue
        matches.append((start_token[1], source_tokens[source_index][2]))
    return list(dict.fromkeys(matches))


def _source_tokens(value: str) -> list[tuple[str, int, int]]:
    return [
        (unicodedata.normalize("NFKC", match.group(0)).lower(), match.start(), match.end())
        for match in re.finditer(r"[^\W_]+", value, flags=re.UNICODE)
    ]


def _find_next_token(tokens: list[tuple[str, int, int]], value: str, start_index: int) -> int:
    end_index = min(len(tokens), start_index + _MAX_SKIPPED_TOKENS_PER_STEP + 1)
    for index in range(start_index, end_index):
        if tokens[index][0] == value:
            return index
    return -1


def _unsafe_skipped_token(value: str) -> bool:
    return value in _UNSAFE_SKIPPED_TOKENS or any(character.isdigit() for character in value)
