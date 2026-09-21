import pymupdf

from services.card_benchmark.extraction import extract_source_pages, segment_pages
from services.card_benchmark.models import Page


def test_segmenter_uses_stable_ids_and_page_boundaries():
    text = "Mechanism\n" + "Metformin reduces hepatic glucose production. " * 30
    pages = [Page(locator="Page 1", text=text), Page(locator="Page 2", text="Definition\n" + "A sufficiently long definition sentence. " * 4)]
    first = segment_pages(pages, "Source")
    second = segment_pages(pages, "Source")
    assert first == second
    assert first
    assert all(item.locator in {"Page 1", "Page 2"} for item in first)
    assert all(len(item.text) >= 50 for item in first)


def test_segmenter_parity_heading_behavior():
    pages = [Page(locator="Page 3", text="TREATMENT:\nThis treatment reduces symptoms and improves function with careful monitoring.")]
    segments = segment_pages(pages, "Source")
    assert len(segments) == 1
    assert segments[0].sectionPath == "TREATMENT"
    assert segments[0].startOffset == pages[0].text.index("This treatment")


def test_blank_pdf_page_is_returned_as_diagnostic_record(tmp_path):
    path = tmp_path / "blank.pdf"
    document = pymupdf.open()
    document.new_page()
    document.save(path)
    document.close()

    page_count, pages = extract_source_pages(path)

    assert page_count == 1
    assert len(pages) == 1
    assert pages[0].text == ""
    assert "missing_selectable_text" in pages[0].extractionWarnings
