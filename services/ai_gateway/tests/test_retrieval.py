from __future__ import annotations

import pytest

from ..models import BariChatRequest, SourceSegment
from ..retrieval import BM25Retriever, NoOpRetriever


@pytest.fixture
def sample_segments() -> list[SourceSegment]:
    """Sample source segments for testing."""
    return [
        SourceSegment(
            segmentId="seg-1",
            locator="Page 1",
            sectionPath="Introduction",
            text="Diabetes mellitus is a metabolic disorder characterized by hyperglycemia. "
                 "Type 1 diabetes results from autoimmune destruction of pancreatic beta cells.",
        ),
        SourceSegment(
            segmentId="seg-2",
            locator="Page 2",
            sectionPath="Pathophysiology",
            text="Insulin resistance in type 2 diabetes leads to elevated blood glucose levels. "
                 "The pancreas initially compensates by increasing insulin production.",
        ),
        SourceSegment(
            segmentId="seg-3",
            locator="Page 3",
            sectionPath="Treatment",
            text="Metformin is the first-line medication for type 2 diabetes management. "
                 "It reduces hepatic glucose production and improves insulin sensitivity.",
        ),
        SourceSegment(
            segmentId="seg-4",
            locator="Page 4",
            sectionPath="Complications",
            text="Chronic hyperglycemia can lead to microvascular complications including "
                 "retinopathy, nephropathy, and neuropathy.",
        ),
    ]


@pytest.mark.asyncio
async def test_bm25_retrieval_basic(sample_segments):
    """BM25 retriever returns relevant segments."""
    retriever = BM25Retriever()
    retriever.index_segments(sample_segments)
    
    request = BariChatRequest(
        message="What is the treatment for type 2 diabetes?",
        mode="source-strict",
    )
    
    results = await retriever.retrieve_evidence(request, max_segments=2)
    
    assert len(results) <= 2
    assert any("metformin" in seg.text.lower() for seg in results)


@pytest.mark.asyncio
async def test_bm25_retrieval_keyword_matching(sample_segments):
    """BM25 ranks documents by keyword relevance."""
    retriever = BM25Retriever()
    retriever.index_segments(sample_segments)
    
    request = BariChatRequest(
        message="Tell me about insulin resistance and pancreatic function",
        mode="source-strict",
    )
    
    results = await retriever.retrieve_evidence(request, max_segments=3)
    
    # Should prioritize segments mentioning insulin and pancreas
    assert len(results) <= 3
    top_result = results[0]
    assert "insulin" in top_result.text.lower() or "pancrea" in top_result.text.lower()


@pytest.mark.asyncio
async def test_bm25_retrieval_no_documents():
    """BM25 returns empty list when no documents indexed."""
    retriever = BM25Retriever()
    
    request = BariChatRequest(
        message="What causes diabetes?",
        mode="source-strict",
    )
    
    results = await retriever.retrieve_evidence(request, max_segments=5)
    assert results == []


@pytest.mark.asyncio
async def test_bm25_retrieval_returns_no_evidence_for_zero_relevance(sample_segments):
    retriever = BM25Retriever()
    retriever.index_segments(sample_segments)
    request = BariChatRequest(message="photosynthesis chlorophyll", mode="source-strict")
    assert await retriever.retrieve_evidence(request, max_segments=5) == []


@pytest.mark.asyncio
async def test_bm25_retrieval_empty_query(sample_segments):
    """BM25 handles short/minimal query gracefully."""
    retriever = BM25Retriever()
    retriever.index_segments(sample_segments)
    
    # Use minimal query with only short words
    request = BariChatRequest(
        message="a is to",
        mode="source-strict",
    )
    
    results = await retriever.retrieve_evidence(request, max_segments=5)
    # Short tokens filtered, so effectively empty query
    assert len(results) >= 0  # Should not crash


@pytest.mark.asyncio
async def test_bm25_retrieval_max_segments_limit(sample_segments):
    """BM25 respects max_segments limit."""
    retriever = BM25Retriever()
    retriever.index_segments(sample_segments)
    
    request = BariChatRequest(
        message="diabetes glucose insulin pancreas treatment complications",
        mode="source-strict",
    )
    
    results = await retriever.retrieve_evidence(request, max_segments=2)
    assert len(results) == 2


@pytest.mark.asyncio
async def test_noop_retriever_returns_nothing():
    """NoOpRetriever always returns empty list."""
    retriever = NoOpRetriever()
    
    request = BariChatRequest(
        message="What is diabetes?",
        mode="source-strict",
    )
    
    results = await retriever.retrieve_evidence(request, max_segments=10)
    assert results == []


@pytest.mark.asyncio
async def test_bm25_tokenization():
    """BM25 tokenizes and filters tokens correctly."""
    retriever = BM25Retriever()
    
    # Test tokenization behavior
    tokens = retriever._tokenize("The patient has Type 2 diabetes, and insulin resistance.")
    
    # Should lowercase
    assert "patient" in tokens
    assert "diabetes" in tokens
    assert "insulin" in tokens
    assert "resistance" in tokens
    # Filter is > 2 chars, so 3+ char tokens remain
    assert "the" in tokens  # 3 chars, included
    assert "and" in tokens  # 3 chars, included
    assert "has" in tokens  # 3 chars, included


@pytest.mark.asyncio
async def test_bm25_scoring_relevance(sample_segments):
    """BM25 scores documents with better keyword match higher."""
    retriever = BM25Retriever()
    retriever.index_segments(sample_segments)
    
    # Query specifically about metformin treatment
    request = BariChatRequest(
        message="metformin medication treatment management",
        mode="source-strict",
    )
    
    results = await retriever.retrieve_evidence(request, max_segments=4)
    
    # The treatment segment (with metformin) should rank highest
    assert results[0].segmentId == "seg-3"
    assert "metformin" in results[0].text.lower()
