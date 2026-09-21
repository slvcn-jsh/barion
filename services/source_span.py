from __future__ import annotations

import hashlib
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
