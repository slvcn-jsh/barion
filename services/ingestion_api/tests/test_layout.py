from __future__ import annotations

import io
import pymupdf
import pytest
from fastapi.testclient import TestClient

from services.ingestion_api.layout import (
    PositionedItem,
    extract_page_items,
    extract_page_structured_text,
    structure_pdf_text,
)
from services.ingestion_api.main import app


def make_item(text: str, x: float, y: float, bold: bool = False, size: float = 10.0) -> PositionedItem:
    return PositionedItem(
        text=text,
        x=x,
        y=y,
        size=size,
        width=max(20.0, len(text) * 4.0),
        bold=bold,
    )


def test_structure_pdf_text_reconstructs_table():
    items = [
        make_item("METHOD", 10, 700, bold=True),
        make_item("HOW IT WORKS", 150, 700, bold=True),
        make_item("HOW IT IS USED", 310, 700, bold=True),
        make_item("EFFECTIVENESS", 470, 700, bold=True),
        make_item("ADVANTAGES", 590, 700, bold=True),
        make_item("DISADVANTAGES", 700, 700, bold=True),
        make_item("Contraceptive Patch", 10, 650, bold=True, size=11.0),
        make_item("Available by prescription.", 10, 625),
        make_item("Releases hormones through skin.", 150, 640),
        make_item("Applied weekly for three weeks.", 310, 640),
        make_item("99% effective.", 470, 640),
        make_item("Continuous protection.", 590, 640),
        make_item("No protection against STIs.", 700, 640),
        make_item("Depo-Provera", 10, 500, bold=True, size=11.0),
        make_item("Available from a clinician.", 10, 475),
        make_item("Artificial hormone injection.", 150, 490),
        make_item("Given every 12 weeks.", 310, 490),
        make_item("More than 99% effective.", 470, 490),
        make_item("Four injections each year.", 590, 490),
        make_item("May delay return to fertility.", 700, 490),
    ]
    # Reverse to emulate scrambled physical item order
    items.reverse()

    text = structure_pdf_text(items)
    assert "# Contraceptive Patch" in text
    assert "# Depo-Provera" in text
    assert "How it is used: Applied weekly for three weeks." in text
    assert "How it is used: Given every 12 weeks." in text

    # Verify column boundaries do not leak across methods
    patch_section = text.split("# Depo-Provera")[0]
    depo_section = text.split("# Depo-Provera")[1]

    assert "Applied weekly for three weeks." in patch_section
    assert "Artificial hormone injection." not in patch_section
    assert "Given every 12 weeks." in depo_section
    assert "Releases hormones through skin." not in depo_section


def test_structure_pdf_text_multi_span_and_vertical_jitter():
    items = [
        make_item("METHOD", 10, 702, bold=True),
        make_item("HOW IT", 150, 698, bold=True),
        make_item("WORKS", 210, 698, bold=True),
        make_item("HOW IT IS", 310, 701, bold=True),
        make_item("USED", 390, 701, bold=True),
        make_item("EFFECTIVENESS", 470, 696, bold=True),
        make_item("ADVANTAGES", 590, 703, bold=True),
        make_item("DISADVANTAGES", 700, 697, bold=True),
        make_item("I.U.D.", 10, 650, bold=True, size=11.0),
        make_item("Small device inserted into uterus.", 150, 640),
        make_item("Checked monthly.", 310, 640),
        make_item("99% effective.", 470, 640),
        make_item("Long-lasting.", 590, 640),
        make_item("Insertion discomfort.", 700, 640),
        make_item("Nexplanon", 10, 500, bold=True, size=11.0),
        make_item("Single rod in upper arm.", 150, 490),
        make_item("Kept in place for three years.", 310, 490),
        make_item("99% effective.", 470, 490),
        make_item("Continuous protection.", 590, 490),
        make_item("No protection against STIs.", 700, 490),
    ]

    text = structure_pdf_text(items)
    assert "# I.U.D." in text
    assert "# Nexplanon" in text
    assert "How it is used: Checked monthly." in text
    assert "How it is used: Kept in place for three years." in text


def test_structure_pdf_text_infers_method_column_for_wrapped_alias_headers():
    items = [
        make_item("WHAT IT IS", 150, 704, bold=True),
        make_item("HOW TO", 320, 704, bold=True),
        make_item("USE", 320, 692, bold=True),
        make_item("EFFICACY", 480, 698, bold=True),
        make_item("BENEFITS", 590, 706, bold=True),
        make_item("POSSIBLE SIDE", 700, 704, bold=True),
        make_item("EFFECTS", 700, 692, bold=True),
        make_item("Contraceptive Patch", 10, 650, bold=True, size=11.0),
        make_item("Small thin smooth patch attached to skin.", 150, 635),
        make_item("Apply on the same day each week.", 320, 635),
        make_item("More than 99% effective.", 480, 635),
        make_item("Continuous protection.", 590, 635),
        make_item("Potential side-effects similar to pills.", 700, 635),
        make_item("Depo-Provera", 10, 500, bold=True, size=11.0),
        make_item("Artificial hormone injection.", 150, 485),
        make_item("Receive every 12 weeks.", 320, 485),
        make_item("More than 99% effective.", 480, 485),
        make_item("Four injections each year.", 590, 485),
        make_item("May delay return to fertility.", 700, 485),
    ]

    text = structure_pdf_text(items)
    patch_section, depo_section = text.split("# Depo-Provera")
    assert "# Contraceptive Patch" in patch_section
    assert "Description: Small thin smooth patch attached to skin." in patch_section
    assert "How it is used: Apply on the same day each week." in patch_section
    assert "Artificial hormone injection." not in patch_section
    assert "How it is used: Receive every 12 weeks." in depo_section


def test_structure_pdf_text_reading_order():
    items = [
        make_item("Second paragraph of the document.", 20, 600),
        make_item("Document Title", 20, 700, bold=True, size=16.0),
        make_item("First paragraph of the document.", 20, 650),
    ]
    text = structure_pdf_text(items)
    assert text.index("Document Title") < text.index("First paragraph")
    assert text.index("First paragraph") < text.index("Second paragraph")


def test_extract_page_structured_text_with_mupdf():
    doc = pymupdf.open()
    page = doc.new_page(width=800, height=600)

    # Insert table headers
    page.insert_text((50, 50), "METHOD", fontsize=11)
    page.insert_text((200, 50), "HOW IT WORKS", fontsize=11)
    page.insert_text((350, 50), "EFFECTIVENESS", fontsize=11)

    # Insert row 1
    page.insert_text((50, 150), "Abstinence", fontsize=12)
    page.insert_text((200, 150), "No sexual intercourse.", fontsize=10)
    page.insert_text((350, 150), "100% effective.", fontsize=10)

    # Insert row 2
    page.insert_text((50, 250), "Withdrawal", fontsize=12)
    page.insert_text((200, 250), "Male does not ejaculate inside.", fontsize=10)
    page.insert_text((350, 250), "25% failure rate.", fontsize=10)

    extracted = extract_page_structured_text(page)
    assert "# Abstinence" in extracted
    assert "# Withdrawal" in extracted
    assert "100% effective." in extracted
    assert "25% failure rate." in extracted
    doc.close()


def test_fastapi_extract_endpoint_with_table_pdf():
    client = TestClient(app)
    doc = pymupdf.open()
    page = doc.new_page(width=800, height=600)
    page.insert_text((50, 50), "METHOD", fontsize=11)
    page.insert_text((200, 50), "HOW IT WORKS", fontsize=11)
    page.insert_text((350, 50), "EFFECTIVENESS", fontsize=11)

    page.insert_text((50, 150), "Contraceptive Patch", fontsize=12)
    page.insert_text((200, 150), "Hormonal transdermal patch.", fontsize=10)
    page.insert_text((350, 150), "99% effective.", fontsize=10)

    page.insert_text((50, 250), "Depo-Provera", fontsize=12)
    page.insert_text((200, 250), "Progestin injection.", fontsize=10)
    page.insert_text((350, 250), "99% effective.", fontsize=10)

    pdf_bytes = doc.tobytes()
    doc.close()

    response = client.post(
        "/v1/extract",
        files={"file": ("reviewer.pdf", io.BytesIO(pdf_bytes), "application/pdf")},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["filename"] == "reviewer.pdf"
    assert data["pageCount"] == 1
    page1 = data["pages"][0]["text"]
    assert "# Contraceptive Patch" in page1
    assert "# Depo-Provera" in page1
    assert "Hormonal transdermal patch." in page1
