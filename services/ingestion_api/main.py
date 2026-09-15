from __future__ import annotations

import os
from io import BytesIO

import pymupdf
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

MAX_PDF_BYTES = 30 * 1024 * 1024
MAX_PDF_PAGES = 160

app = FastAPI(
    title="Barion Ingestion API",
    version="1.0.0",
    description="Stateless text extraction for Barion mobile PDF imports.",
)

allowed_origins = [
    origin.strip()
    for origin in os.getenv(
        "BARION_ALLOWED_ORIGINS",
        "http://localhost:8081,http://127.0.0.1:8081",
    ).split(",")
    if origin.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/v1/extract")
async def extract_pdf(file: UploadFile = File(...)) -> dict[str, object]:
    filename = file.filename or "source.pdf"
    if file.content_type != "application/pdf" and not filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=415, detail="Only PDF files are accepted by this endpoint.")

    chunks: list[bytes] = []
    size = 0
    while chunk := await file.read(1024 * 1024):
        size += len(chunk)
        if size > MAX_PDF_BYTES:
            raise HTTPException(status_code=413, detail="This PDF is larger than 30 MB. Split it into smaller chapters.")
        chunks.append(chunk)
    await file.close()

    try:
        document = pymupdf.open(stream=BytesIO(b"".join(chunks)), filetype="pdf")
    except Exception as error:
        raise HTTPException(status_code=422, detail="The PDF is damaged or is not a readable PDF file.") from error

    try:
        if document.needs_pass:
            raise HTTPException(status_code=422, detail="This PDF is password protected. Remove the password and try again.")
        if document.page_count > MAX_PDF_PAGES:
            raise HTTPException(
                status_code=413,
                detail=f"This PDF has {document.page_count} pages. Import a chapter of {MAX_PDF_PAGES} pages or fewer.",
            )

        pages = []
        for page_number, page in enumerate(document, start=1):
            text = page.get_text("text", sort=True).strip()
            if text:
                pages.append({"locator": f"Page {page_number}", "text": text})

        if not pages:
            raise HTTPException(
                status_code=422,
                detail="No selectable text was found. This appears to be a scanned PDF and needs OCR.",
            )
        return {"filename": filename, "pageCount": document.page_count, "pages": pages}
    finally:
        document.close()
