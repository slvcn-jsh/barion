from __future__ import annotations

import re
import statistics
from dataclasses import dataclass, field
from typing import Any

import pymupdf


@dataclass
class PositionedItem:
    text: str
    x: float
    y: float
    size: float
    width: float
    bold: bool
    has_eol: bool = False


@dataclass
class TableColumn:
    label: str
    x: float
    min_y: float
    max_y: float


@dataclass
class TextLine:
    y: float
    items: list[PositionedItem] = field(default_factory=list)
    text: str = ""


TABLE_LABELS: list[tuple[re.Pattern, str]] = [
    (re.compile(r"^methods?$", re.IGNORECASE), "Method"),
    (re.compile(r"^(?:description|what\s+it\s+is)$", re.IGNORECASE), "Description"),
    (re.compile(r"^(?:how\s+it\s+works|mechanism)$", re.IGNORECASE), "How it works"),
    (re.compile(r"^(?:how\s+it\s+is\s+used|how\s+to\s+use|use)$", re.IGNORECASE), "How it is used"),
    (re.compile(r"^(?:effectiveness|efficacy)$", re.IGNORECASE), "Effectiveness"),
    (re.compile(r"^(?:advantages?|benefits?)$", re.IGNORECASE), "Advantages"),
    (re.compile(r"^(?:disadvantages?|possible\s+side[\s-]*effects?|side[\s-]*effects?|risks?)$", re.IGNORECASE), "Disadvantages"),
    (re.compile(r"^(?:availability|where\s+(?:available|to\s+get)|where\s+obtained)$", re.IGNORECASE), "Availability"),
]


def extract_page_items(page: pymupdf.Page) -> list[PositionedItem]:
    d = page.get_text("dict")
    page_height = float(d.get("height", page.rect.height))
    items: list[PositionedItem] = []
    for block in d.get("blocks", []):
        if block.get("type", 0) != 0:
            continue
        for line in block.get("lines", []):
            spans = line.get("spans", [])
            for idx, span in enumerate(spans):
                raw_text = span.get("text", "")
                text = re.sub(r"\s+", " ", raw_text).strip()
                bbox = span.get("bbox")
                if not text or not bbox:
                    continue
                x = float(bbox[0])
                # Convert top-down PDF coords to bottom-up matching PDF.js
                y = float(page_height - bbox[1])
                size = max(float(span.get("size", 11.0)), 1.0)
                width = max(float(bbox[2] - bbox[0]), len(text) * size * 0.35)
                font = span.get("font", "").lower()
                flags = span.get("flags", 0)
                bold = any(k in font for k in ("bold", "black", "semibold", "demi")) or bool(flags & (1 << 4)) or bool(flags & 2)
                has_eol = (idx == len(spans) - 1)
                items.append(
                    PositionedItem(
                        text=text,
                        x=x,
                        y=y,
                        size=size,
                        width=width,
                        bold=bold,
                        has_eol=has_eol,
                    )
                )
    return items


def structure_pdf_text(items: list[PositionedItem]) -> str:
    if not items:
        return ""
    sizes = [item.size for item in items]
    body_size = float(statistics.median(sizes)) if sizes else 11.0
    lines = group_into_lines(items, body_size)
    table = detect_table(lines, body_size)
    if table:
        reconstructed = reconstruct_table(
            lines, table["columns"], table["header_min_y"], table["header_max_y"], body_size
        )
        if reconstructed:
            return reconstructed
    return reconstruct_reading_order(lines, body_size)


def extract_page_structured_text(page: pymupdf.Page) -> str:
    items = extract_page_items(page)
    return structure_pdf_text(items)


def group_into_lines(items: list[PositionedItem], body_size: float) -> list[TextLine]:
    tolerance = max(2.0, body_size * 0.38)
    sorted_items = sorted(items, key=lambda it: (-it.y, it.x))
    lines: list[TextLine] = []
    for item in sorted_items:
        found_line = None
        for line in lines:
            if abs(line.y - item.y) <= tolerance:
                found_line = line
                break
        if found_line is not None:
            found_line.items.append(item)
            found_line.y = sum(it.y for it in found_line.items) / len(found_line.items)
        else:
            lines.append(TextLine(y=item.y, items=[item]))

    result: list[TextLine] = []
    for line in sorted(lines, key=lambda l: -l.y):
        sorted_line_items = sorted(line.items, key=lambda it: it.x)
        result.append(
            TextLine(
                y=line.y,
                items=sorted_line_items,
                text=join_items(sorted_line_items),
            )
        )
    return result


def detect_table(lines: list[TextLine], body_size: float) -> dict[str, Any] | None:
    vertical_tolerance = max(8.0, body_size * 2.8)
    document_min_x = min(item.x for line in lines for item in line.items)
    for line in lines:
        band_lines = [other for other in lines if abs(other.y - line.y) <= vertical_tolerance]
        band_items = [it for l in band_lines for it in l.items]
        columns = extract_columns_from_items(band_items, body_size)
        unique_columns = dedupe_columns(columns)
        unique_columns.sort(key=lambda c: c.x)

        if len(unique_columns) >= 2 and any(it.size >= body_size or it.bold for it in band_items):
            if not unique_columns or unique_columns[0].label != "Method":
                unique_columns.insert(0, TableColumn(
                    label="Method",
                    x=document_min_x,
                    min_y=min(column.min_y for column in unique_columns),
                    max_y=max(column.max_y for column in unique_columns),
                ))
            header_min_y = min(column.min_y for column in unique_columns)
            header_max_y = max(column.max_y for column in unique_columns)
            return {
                "columns": unique_columns,
                "header_min_y": header_min_y,
                "header_max_y": header_max_y,
            }
    return None


def extract_columns_from_items(items: list[PositionedItem], body_size: float) -> list[TableColumn]:
    sorted_items = sorted(items, key=lambda it: (it.x, -it.y))
    columns: list[TableColumn] = []
    i = 0
    while i < len(sorted_items):
        best_match = None
        accumulated_text = ""
        for count in range(1, min(6, len(sorted_items) - i + 1)):
            current_item = sorted_items[i + count - 1]
            if count > 1:
                prev_item = sorted_items[i + count - 2]
                horizontal_gap = current_item.x - (prev_item.x + prev_item.width)
                x_offset = abs(current_item.x - prev_item.x)
                if horizontal_gap > body_size * 6.0 and x_offset > body_size * 4.0:
                    break
            accumulated_text = (
                current_item.text if count == 1 else f"{accumulated_text} {current_item.text}"
            )
            normalized = re.sub(r"\s+", " ", accumulated_text).strip()
            for pattern, label in TABLE_LABELS:
                if pattern.match(normalized):
                    matched_items = sorted_items[i:i + count]
                    best_match = (
                        label,
                        min(item.x for item in matched_items),
                        count,
                        min(item.y for item in matched_items),
                        max(item.y for item in matched_items),
                    )
                    break
        if best_match:
            label, x, count, min_y, max_y = best_match
            columns.append(TableColumn(label=label, x=x, min_y=min_y, max_y=max_y))
            i += count
        else:
            i += 1
    return columns


def reconstruct_table(
    lines: list[TextLine],
    columns: list[TableColumn],
    header_min_y: float,
    header_max_y: float,
    body_size: float,
) -> str:
    body_lines = [line for line in lines if line.y < header_min_y - body_size * 0.5]
    first_column_end = columns[1].x if len(columns) > 1 else float("inf")

    first_column_lines: list[TextLine] = []
    for line in body_lines:
        col_items = [it for it in line.items if it.x < first_column_end - body_size * 0.25]
        if col_items:
            first_column_lines.append(
                TextLine(
                    y=line.y,
                    items=col_items,
                    text=join_items(col_items),
                )
            )

    method_lines = [l for l in first_column_lines if is_method_anchor(l, body_size)]
    anchors = merge_method_anchors(method_lines, body_size)
    if len(anchors) < 2:
        return ""

    prefix_lines = [line for line in lines if line.y > header_max_y + body_size * 0.5]
    prefix = reconstruct_reading_order(prefix_lines, body_size)

    separator = "\n\n"
    rows: list[str] = []
    for index, anchor in enumerate(anchors):
        next_y = anchors[index + 1].y if index + 1 < len(anchors) else float("-inf")
        row_items = [
            it
            for line in body_lines
            if (anchor.y + body_size * 0.5 >= line.y > next_y + body_size * 0.5)
            for it in line.items
        ]
        cells = []
        for col_idx, col in enumerate(columns):
            next_x = columns[col_idx + 1].x if col_idx + 1 < len(columns) else float("inf")
            cell_items = [
                it
                for it in row_items
                if (it.x >= col.x - body_size * 0.35 and it.x < next_x - body_size * 0.2)
            ]
            cells.append({"label": col.label, "text": cell_text(cell_items, body_size)})

        method = re.sub(r"^#+\s*", "", anchor.text).strip()
        fields = [
            f"{cell['label']}: {cell['text']}"
            for cell in cells
            if cell["label"] != "Method" and cell["text"]
        ]
        method_cell = next((c["text"] for c in cells if c["label"] == "Method"), "")
        availability = method_cell.replace(method, "")
        availability = re.sub(r"^\s*[:\-]?\s*", "", availability).strip()
        if availability:
            fields.insert(0, f"Availability: {availability}")
        rows.append(f"# {method}\n\n" + separator.join(fields).strip())

    result_parts = [prefix, separator.join(rows)]
    return separator.join(p for p in result_parts if p).strip()


def is_method_anchor(line: TextLine, body_size: float) -> bool:
    text = line.text.strip()
    words = [w for w in text.split() if w]
    if not text or len(text) > 100 or len(words) > 10:
        return False
    if re.search(r"^(available|schedule|if interested|talk with|university|page\s+\d+|call\b)", text, re.IGNORECASE):
        return False
    if re.search(r"^(method|how it|effectiveness|advantages?|disadvantages?)$", text, re.IGNORECASE):
        return False
    if text.endswith("?") or text.endswith("!") or re.search(r":\s+\S", text):
        return False
    title_like = (
        any(it.bold or it.size >= body_size * 1.08 for it in line.items)
        or bool(re.match(r"^[A-Z0-9][A-Z0-9.()&\-\s]+$", text))
    )
    return title_like


def merge_method_anchors(lines: list[TextLine], body_size: float) -> list[TextLine]:
    sorted_lines = sorted(lines, key=lambda l: -l.y)
    anchors: list[TextLine] = []
    for line in sorted_lines:
        prev = anchors[-1] if anchors else None
        gap = (prev.y - line.y) if prev else float("inf")
        continuation = (
            prev is not None
            and 0 < gap <= body_size * 1.65
            and (
                line.text.startswith("(")
                or (len(prev.text.split()) + len(line.text.split()) <= 10)
            )
        )
        if continuation:
            prev.text = re.sub(r"\s+", " ", f"{prev.text} {line.text}").strip()
            prev.items.extend(line.items)
        else:
            anchors.append(TextLine(y=line.y, items=list(line.items), text=line.text))
    return anchors


def cell_text(items: list[PositionedItem], body_size: float) -> str:
    if not items:
        return ""
    grouped = group_into_lines(items, body_size)
    lines_text = [line.text for line in grouped if not is_page_noise(line.text)]
    joined = " ".join(lines_text)
    return re.sub(r"\s+", " ", joined).strip()


def reconstruct_reading_order(lines: list[TextLine], body_size: float) -> str:
    output: list[str] = []
    prev_y = None
    for line in lines:
        if is_page_noise(line.text):
            continue
        largest_size = max(it.size for it in line.items)
        heading = largest_size >= body_size * 1.3 and len(line.text) <= 120
        gap = 0.0 if prev_y is None else prev_y - line.y
        if output:
            output.append("\n\n" if (heading or gap > body_size * 1.8) else "\n")
        output.append(f"# {line.text}\n" if heading else line.text)
        prev_y = line.y
    return "".join(output).strip()


def join_items(items: list[PositionedItem]) -> str:
    output: list[str] = []
    prev = None
    for item in items:
        expected_end = (prev.x + prev.width) if prev else item.x
        gap = item.x - expected_end
        separator = " " if (prev and gap > max(1.5, item.size * 0.12)) else ""
        output.append(f"{separator}{item.text}")
        prev = item
    raw = "".join(output)
    return re.sub(r"\s+", " ", raw).strip()


def dedupe_columns(columns: list[TableColumn]) -> list[TableColumn]:
    seen = set()
    res = []
    for c in columns:
        if c.label not in seen:
            seen.add(c.label)
            res.append(c)
    return res


def is_page_noise(value: str) -> bool:
    text = value.strip()
    return bool(
        re.match(r"^page\s+\d+(?:\s+of\s+\d+)?$", text, re.IGNORECASE) or re.match(r"^\d+$", text)
    )
