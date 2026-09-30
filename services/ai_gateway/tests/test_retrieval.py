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


from ..retrieval import HybridRetriever, MockEmbeddingProvider, cosine_similarity


@pytest.mark.asyncio
async def test_cosine_similarity():
    v1 = [1.0, 0.0, 0.0]
    v2 = [1.0, 0.0, 0.0]
    assert cosine_similarity(v1, v2) == 1.0

    v3 = [0.0, 1.0, 0.0]
    assert cosine_similarity(v1, v3) == 0.0


@pytest.mark.asyncio
async def test_hybrid_retriever_fusion(sample_segments):
    retriever = HybridRetriever(embedding_provider=MockEmbeddingProvider(dimension=32), alpha=0.5)
    await retriever.index_segments(sample_segments)

    request = BariChatRequest(
        message="metformin and glucose production",
        mode="source-strict",
    )

    results = await retriever.retrieve_evidence(request, max_segments=2)
    assert len(results) <= 2
    assert any("metformin" in s.text.lower() for s in results)


@pytest.mark.asyncio
async def test_hybrid_retriever_empty():
    retriever = HybridRetriever()
    await retriever.index_segments([])

    request = BariChatRequest(
        message="metformin",
        mode="source-strict",
    )
    results = await retriever.retrieve_evidence(request, max_segments=3)
    assert results == []

from ..retrieval import GeminiEmbeddingProvider
import httpx


@pytest.mark.asyncio
async def test_gemini_embedding_provider_caching_and_fallback():
    provider = GeminiEmbeddingProvider(
        api_key="test-key",
        model="text-embedding-004",
        dimension=64,
        fallback_provider=MockEmbeddingProvider(dimension=64),
    )

    texts = ["metformin pharmacology", "beta blocker mechanism", "metformin pharmacology"]
    embeddings = await provider.embed_texts(texts)

    assert len(embeddings) == 3
    assert len(embeddings[0]) == 64
    assert embeddings[0] == embeddings[2]  # Cache hit returns identical vector
    assert "metformin pharmacology" in provider._cache


@pytest.mark.asyncio
async def test_gemini_embedding_provider_batching():
    provider = GeminiEmbeddingProvider(
        api_key="test-key",
        max_batch_size=2,
        dimension=32,
        fallback_provider=MockEmbeddingProvider(dimension=32),
    )
    texts = [f"segment text number {i}" for i in range(5)]
    embeddings = await provider.embed_texts(texts)
    assert len(embeddings) == 5
    assert all(len(vec) == 32 for vec in embeddings)


@pytest.mark.asyncio
async def test_retrieval_quality_benchmark():
    corpus = [
        SourceSegment(segmentId="s1", locator="p. 10", sectionPath="Cardio", text="ACE inhibitors such as lisinopril cause dry cough in ~10% of patients due to bradykinin accumulation."),
        SourceSegment(segmentId="s2", locator="p. 15", sectionPath="Endo", text="Normal fasting plasma glucose is 70-99 mg/dL; HbA1c < 5.7% is normal."),
        SourceSegment(segmentId="s3", locator="p. 20", sectionPath="Renal", text="Acute kidney injury (AKI) is defined by an increase in serum creatinine by ≥ 0.3 mg/dL within 48 hours."),
        SourceSegment(segmentId="s4", locator="p. 25", sectionPath="Micro", text="Pseudomonas aeruginosa is an oxidase-positive, gram-negative rod producing pyocyanin."),
        SourceSegment(segmentId="s5", locator="p. 30", sectionPath="Pharm", text="β1-blockers like atenolol decrease chronotropy and inotropy in the myocardium."),
    ]
    retriever = HybridRetriever(embedding_provider=MockEmbeddingProvider(dimension=64))
    await retriever.index_segments(corpus)

    test_queries = [
        ("Why does lisinopril cause a dry cough?", "s1"),
        ("What is the normal fasting plasma glucose and HbA1c?", "s2"),
        ("AKI diagnostic criteria serum creatinine cutoff", "s3"),
        ("Oxidase positive gram negative rod pyocyanin", "s4"),
        ("β1-blocker atenolol cardiac effect", "s5"),
    ]

    top1_hits = 0
    top3_hits = 0
    for query, target_id in test_queries:
        req = BariChatRequest(message=query, mode="source-strict")
        results = await retriever.retrieve_evidence(req, max_segments=3)
        segment_ids = [r.segmentId for r in results]
        if segment_ids and segment_ids[0] == target_id:
            top1_hits += 1
        if target_id in segment_ids:
            top3_hits += 1

    recall_at_3 = top3_hits / len(test_queries)
    recall_at_1 = top1_hits / len(test_queries)

    assert recall_at_3 == 1.0, f"Recall@3 should be 100%, got {recall_at_3}"
    assert recall_at_1 >= 0.8, f"Recall@1 should be >= 80%, got {recall_at_1}"
