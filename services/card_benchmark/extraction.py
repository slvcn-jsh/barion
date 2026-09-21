from __future__ import annotations

import re
from pathlib import Path

import pymupdf

from .io_utils import sha256_file, sha256_text
from .models import Page, Segment, StructuralUnit

STRUCTURAL_EXTRACTION_VERSION = "2.0.0"

TARGET_CHARS = 1100
MAX_CHARS = 1600
MIN_CHARS = 50


def extract_source_pages(path: Path) -> tuple[int, list[Page]]:
    """Extract every PDF page, retaining diagnostic records for pages without text."""
    document = pymupdf.open(path)
    source_id = f"source-{sha256_file(path)[:20]}"
    try:
        if document.needs_pass:
            raise ValueError("Source PDF is password protected.")
        pages = []
        for page_index, page in enumerate(document):
            text = page.get_text("text", sort=True).strip()
            warnings = _pdf_layout_warnings(page, text)
            if not text:
                warnings = (*warnings, "missing_selectable_text")
            pages.append(Page(locator=f"Page {page_index + 1}", text=text, pageIndex=page_index,
                              sourceArtifactId=source_id, extractionWarnings=tuple(sorted(set(warnings)))))
        return document.page_count, pages
    finally:
        document.close()


def _pdf_layout_warnings(page: pymupdf.Page, text: str) -> tuple[str, ...]:
    warnings: set[str] = set()
    blocks = [block for block in page.get_text("blocks", sort=True) if str(block[4]).strip()]
    midpoint = page.rect.width / 2
    left = [block for block in blocks if block[2] <= midpoint * 1.12]
    right = [block for block in blocks if block[0] >= midpoint * 0.88]
    if left and right and any(max(a[1], b[1]) < min(a[3], b[3]) for a in left for b in right):
        warnings.add("multi_column_ambiguity")
    if text and len(re.findall(r"\S+[ \t]{2,}\S+", text)) >= 2:
        warnings.add("table_relationships_unclear")
    words = page.get_text("words", sort=True)
    for index, first in enumerate(words):
        for second in words[index + 1:index + 12]:
            if first[5:8] == second[5:8]:
                continue
            if first[0] < second[2] and second[0] < first[2] and first[1] < second[3] and second[1] < first[3]:
                warnings.add("overlapping_spans")
                break
        if "overlapping_spans" in warnings:
            break
    return tuple(sorted(warnings))


def segment_pages(pages: list[Page], source_title: str) -> list[Segment]:
    """Python parity port of src/ingestion/segmenter.ts with stable IDs."""
    segments: list[Segment] = []
    for page in pages:
        blocks = _split_into_blocks(page.text)
        section_path = source_title
        buffer = ""
        offset = 0

        def flush() -> None:
            nonlocal buffer, offset
            text = buffer.strip()
            if len(text) >= MIN_CHARS:
                probe = text[: min(len(text), 80)]
                start = page.text.find(probe, offset)
                safe_start = start if start >= 0 else offset
                stable_key = f"{page.locator}\0{safe_start}\0{text}"
                segments.append(Segment(
                    segmentId=f"seg-{sha256_text(stable_key)[:16]}",
                    locator=page.locator,
                    sectionPath=section_path,
                    text=text,
                    startOffset=safe_start,
                    endOffset=safe_start + len(text),
                ))
                offset = safe_start + len(text)
            buffer = ""

        for block in blocks:
            if _is_heading(block):
                flush()
                section_path = _clean_heading(block) or source_title
                continue
            if buffer and len(buffer) + len(block) + 2 > MAX_CHARS:
                flush()
            buffer = f"{buffer}\n\n{block}" if buffer else block
            if len(buffer) >= TARGET_CHARS:
                flush()
        flush()
    return segments


def _split_into_blocks(text: str) -> list[str]:
    normalized = re.sub(r"[ \t]+", " ", text.replace("\r\n", "\n").replace("\f", "\n").replace("\x00", "")).strip()
    paragraphs = [value.strip() for value in re.split(r"\n{2,}", normalized) if value.strip()]
    if len(paragraphs) > 1:
        return paragraphs
    lines = [value.strip() for value in normalized.split("\n") if value.strip() and not _is_page_noise(value)]
    if len(lines) > 1:
        return _group_lines(lines)
    return [value.strip() for value in re.split(r"(?<=[.!?])\s+(?=[A-Z0-9#*\-])", normalized) if value.strip()]


def extract_structural_units(pages: list[Page], segments: list[Segment], source_title: str) -> list[StructuralUnit]:
    """Create deterministic, conservative structural units from extracted page text."""
    segment_by_page: dict[str, list[Segment]] = {}
    for segment in segments:
        segment_by_page.setdefault(segment.locator, []).append(segment)
    units: list[StructuralUnit] = []
    for ordinal, page in enumerate(pages):
        page_index = page.pageIndex if page.pageIndex or ordinal == 0 else ordinal
        source_id = page.sourceArtifactId or f"source-{sha256_text(source_title)[:20]}"
        if not page.text:
            units.append(_structural_unit(source_id, page_index, page.locator, source_title, 0, 0, "", "UNKNOWN",
                                          page.extractionWarnings or ("missing_selectable_text",), ""))
            continue
        section = source_title
        cursor = 0
        for raw_line in page.text.splitlines():
            raw = raw_line.strip()
            if not raw:
                continue
            start = page.text.find(raw, cursor)
            if start < 0:
                start = cursor
            end = start + len(raw)
            cursor = end
            segment_id, segment_section = _containing_segment(segment_by_page.get(page.locator, []), start, end)
            if segment_section:
                section = segment_section
            structural_type, extra_warnings = _classify_structural_line(raw)
            if structural_type == "HEADING":
                section = _clean_heading(raw) or section
            warnings = tuple(sorted(set((*page.extractionWarnings, *extra_warnings))))
            units.append(_structural_unit(source_id, page_index, page.locator, section, start, end, raw,
                                          structural_type, warnings, segment_id))
    return units


def _structural_unit(source_id: str, page_index: int, locator: str, section: str, start: int, end: int,
                     raw: str, structural_type: str, warnings: tuple[str, ...], segment_id: str) -> StructuralUnit:
    normalized = " ".join(raw.split())
    severe = {"missing_selectable_text", "multi_column_ambiguity", "overlapping_spans", "broken_line_ordering"}
    confidence = 0.0 if not normalized else (0.55 if severe & set(warnings) else (0.7 if warnings else 0.95))
    identity = f"{STRUCTURAL_EXTRACTION_VERSION}\0{source_id}\0{page_index}\0{start}\0{end}\0{normalized}"
    return StructuralUnit(
        structuralUnitId=f"unit-{sha256_text(identity)[:20]}", sourceArtifactId=source_id, pageIndex=page_index,
        locator=locator, sectionPath=section, startOffset=start, endOffset=end, rawText=raw,
        normalizedText=normalized, structuralType=structural_type, contentHash=sha256_text(normalized),
        extractionConfidence=confidence, warnings=warnings, segmentId=segment_id,
    )


def _containing_segment(segments: list[Segment], start: int, end: int) -> tuple[str, str]:
    for segment in segments:
        if start < segment.endOffset and end > segment.startOffset:
            return segment.segmentId, segment.sectionPath
    return "", ""


def _classify_structural_line(text: str) -> tuple[str, tuple[str, ...]]:
    if re.match(r"^\s*(?:[-*•▪]|\d+[.)])\s+", text):
        stripped = re.sub(r"^\s*(?:[-*•▪]|\d+[.)])\s+", "", text)
        return ("NUMERIC_CRITERION" if _is_numeric_criterion(stripped) else "LIST_ITEM"), ()
    pipe_cells = [cell.strip() for cell in text.split("|") if cell.strip()]
    if len(pipe_cells) >= 2:
        warnings = ("table_relationships_unclear", "heading_data_interleaving") if _is_heading(text) else ("table_relationships_unclear",)
        if len(pipe_cells) >= 3:
            return "COMPARISON_MATRIX", warnings
        return "TABLE_CELL_RELATION", warnings
    cells = [cell.strip() for cell in re.split(r"\t+|\s{2,}", text) if cell.strip()]
    if len(cells) >= 2:
        warnings = ("table_relationships_unclear", "heading_data_interleaving") if _is_heading(text) else ("table_relationships_unclear",)
        return "TABLE_ROW", warnings
    if _is_numeric_criterion(text):
        return "NUMERIC_CRITERION", ()
    if _is_heading(text):
        return "HEADING", ()
    if len(text.split()) >= 3:
        return "PROSE", ()
    return "UNKNOWN", ("broken_line_ordering",)


def _is_numeric_criterion(text: str) -> bool:
    return bool(re.search(r"(?:[<>≤≥]=?|less than|greater than|at least|no more than|within|threshold|criterion|criteria)\s*\d|\d+(?:\.\d+)?\s*(?:%|mg|mcg|g|ml|mL|mmhg|hours?|days?|weeks?|months?|years?|mEq/L)\b", text, re.I))


def _is_heading(value: str) -> bool:
    trimmed = value.strip()
    words = trimmed.split()
    has_sentence_verb = re.search(r"\b(is|are|was|were|has|have|include|includes|causes|reduces|increases|treated|managed|presents)\b", trimmed, re.I)
    if re.match(r"^[-*]\s+", trimmed):
        return False
    if re.match(r"^#{1,6}\s+", trimmed):
        return True
    if has_sentence_verb and len(words) > 4:
        return False
    if trimmed.endswith(":") and len(trimmed) <= 90:
        return True
    return len(trimmed) <= 80 and len(words) <= 10 and not re.search(r"[.!?]$", trimmed)


def _clean_heading(value: str) -> str:
    return re.sub(r":$", "", re.sub(r"^#{1,6}\s+", "", value)).strip()


def _group_lines(lines: list[str]) -> list[str]:
    blocks: list[str] = []
    buffer = ""
    for line in lines:
        starts_list = bool(re.match(r"^([-*]|\d+[.)])\s+", line))
        heading = _is_heading(line)
        if heading or starts_list or len(buffer) + len(line) + 1 > MAX_CHARS:
            if buffer.strip():
                blocks.append(buffer.strip())
            buffer = ""
        buffer = f"{buffer}\n{line}" if buffer else line
        if heading or starts_list or len(buffer) >= TARGET_CHARS:
            blocks.append(buffer.strip())
            buffer = ""
    if buffer.strip():
        blocks.append(buffer.strip())
    return blocks


def _is_page_noise(value: str) -> bool:
    trimmed = value.strip()
    return bool(re.fullmatch(r"\d+", trimmed) or re.fullmatch(r"page\s+\d+(\s+of\s+\d+)?", trimmed, re.I))
