from __future__ import annotations

import math
import re
from collections import Counter
from typing import Protocol

from .models import BariChatRequest, SourceSegment


class SourceRetriever(Protocol):
    """Protocol for retrieving relevant source segments."""

    async def retrieve_evidence(
        self,
        request: BariChatRequest,
        max_segments: int = 5,
    ) -> list[SourceSegment]:
        """Retrieve relevant source segments for a chat request."""
        ...


class EmbeddingProvider(Protocol):
    """Protocol for generating vector embeddings."""

    async def embed_texts(self, texts: list[str]) -> list[list[float]]: ...


class MockEmbeddingProvider:
    """Deterministic, lightweight character/ngram embedding for testing and offline fallback."""

    def __init__(self, dimension: int = 64):
        self.dimension = dimension

    async def embed_texts(self, texts: list[str]) -> list[list[float]]:
        embeddings: list[list[float]] = []
        for text in texts:
            vec = [0.0] * self.dimension
            tokens = [t.lower() for t in re.findall(r"\b\w+\b", text)]
            for t in tokens:
                h = hash(t) % self.dimension
                vec[h] += 1.0
            norm = math.sqrt(sum(x * x for x in vec))
            if norm > 0:
                vec = [x / norm for x in vec]
            embeddings.append(vec)
        return embeddings


class BM25Retriever:
    """BM25 keyword-based text retrieval."""

    def __init__(self, k1: float = 1.5, b: float = 0.75):
        self.k1 = k1
        self.b = b
        self._documents: dict[str, SourceSegment] = {}
        self._doc_lengths: dict[str, int] = {}
        self._avg_doc_length: float = 0.0
        self._idf_cache: dict[str, float] = {}

    def index_segments(self, segments: list[SourceSegment]) -> None:
        """Index source segments for retrieval."""
        self._documents = {seg.segmentId: seg for seg in segments}
        self._doc_lengths = {
            seg.segmentId: len(self._tokenize(seg.text))
            for seg in segments
        }
        total_length = sum(self._doc_lengths.values())
        self._avg_doc_length = total_length / len(segments) if segments else 0.0
        self._compute_idf()

    def _tokenize(self, text: str) -> list[str]:
        """Simple tokenization - lowercase and split on non-alphanumeric."""
        return [
            token.lower()
            for token in re.findall(r"\b\w+\b", text)
            if len(token) > 2
        ]

    def _compute_idf(self) -> None:
        """Compute IDF scores for all terms."""
        term_doc_counts: dict[str, int] = {}
        for segment in self._documents.values():
            unique_terms = set(self._tokenize(segment.text))
            for term in unique_terms:
                term_doc_counts[term] = term_doc_counts.get(term, 0) + 1

        num_docs = len(self._documents)
        self._idf_cache = {
            term: math.log((num_docs - count + 0.5) / (count + 0.5) + 1.0)
            for term, count in term_doc_counts.items()
        }

    def bm25_score(self, query_tokens: list[str], doc_id: str) -> float:
        """Calculate BM25 score for a document."""
        segment = self._documents[doc_id]
        doc_tokens = self._tokenize(segment.text)
        doc_length = self._doc_lengths[doc_id]

        query_term_counts = Counter(query_tokens)
        doc_term_counts = Counter(doc_tokens)

        score = 0.0
        for term, _ in query_term_counts.items():
            if term not in doc_term_counts:
                continue

            idf = self._idf_cache.get(term, 0.0)
            tf = doc_term_counts[term]

            numerator = tf * (self.k1 + 1)
            denominator = tf + self.k1 * (
                1 - self.b + self.b * (doc_length / self._avg_doc_length)
            )
            score += idf * (numerator / denominator)

        return score

    async def retrieve_evidence(
        self,
        request: BariChatRequest,
        max_segments: int = 5,
    ) -> list[SourceSegment]:
        """Retrieve top-k relevant segments based on BM25 ranking."""
        if not self._documents:
            return []

        query_tokens = self._tokenize(request.message)
        if not query_tokens:
            return []

        scored_docs = [
            (doc_id, self.bm25_score(query_tokens, doc_id))
            for doc_id in self._documents
        ]

        scored_docs.sort(key=lambda x: x[1], reverse=True)
        top_doc_ids = [doc_id for doc_id, score in scored_docs if score > 0][:max_segments]
        return [self._documents[doc_id] for doc_id in top_doc_ids]


def cosine_similarity(v1: list[float], v2: list[float]) -> float:
    """Compute cosine similarity between two unit vectors."""
    if not v1 or not v2 or len(v1) != len(v2):
        return 0.0
    dot = sum(a * b for a, b in zip(v1, v2))
    return max(0.0, min(1.0, dot))


class HybridRetriever:
    """Hybrid Retriever combining BM25 keyword matching and dense vector embeddings."""

    def __init__(
        self,
        embedding_provider: EmbeddingProvider | None = None,
        alpha: float = 0.5,
        k1: float = 1.5,
        b: float = 0.75,
    ):
        self.bm25 = BM25Retriever(k1=k1, b=b)
        self.embedding_provider = embedding_provider or MockEmbeddingProvider()
        self.alpha = alpha  # Weight for BM25 vs Dense (0.0 = all dense, 1.0 = all BM25)
        self._doc_embeddings: dict[str, list[float]] = {}
        self._documents: dict[str, SourceSegment] = {}

    async def index_segments(self, segments: list[SourceSegment]) -> None:
        """Index segments for both BM25 and vector search."""
        self._documents = {seg.segmentId: seg for seg in segments}
        self.bm25.index_segments(segments)

        if segments:
            texts = [seg.text for seg in segments]
            vectors = await self.embedding_provider.embed_texts(texts)
            self._doc_embeddings = {
                seg.segmentId: vec
                for seg, vec in zip(segments, vectors)
            }
        else:
            self._doc_embeddings = {}

    async def retrieve_evidence(
        self,
        request: BariChatRequest,
        max_segments: int = 5,
    ) -> list[SourceSegment]:
        """Retrieve top-k segments using Reciprocal Rank Fusion (RRF) of BM25 + dense vectors."""
        if not self._documents:
            return []

        query_tokens = self.bm25._tokenize(request.message)
        if not query_tokens:
            return []

        # 1. BM25 scores
        bm25_scores = {
            doc_id: self.bm25.bm25_score(query_tokens, doc_id)
            for doc_id in self._documents
        }
        sorted_bm25 = sorted(
            [doc_id for doc_id, s in bm25_scores.items() if s > 0],
            key=lambda d: bm25_scores[d],
            reverse=True,
        )

        # 2. Dense Embedding scores
        query_vectors = await self.embedding_provider.embed_texts([request.message])
        query_vec = query_vectors[0] if query_vectors else []

        dense_scores: dict[str, float] = {}
        if query_vec:
            for doc_id, doc_vec in self._doc_embeddings.items():
                sim = cosine_similarity(query_vec, doc_vec)
                dense_scores[doc_id] = sim

        sorted_dense = sorted(
            [doc_id for doc_id, s in dense_scores.items() if s > 0.05],
            key=lambda d: dense_scores[d],
            reverse=True,
        )

        # 3. Reciprocal Rank Fusion (RRF, k=60)
        rrf_k = 60
        rrf_scores: dict[str, float] = {}
        for rank, doc_id in enumerate(sorted_bm25):
            rrf_scores[doc_id] = rrf_scores.get(doc_id, 0.0) + self.alpha / (rrf_k + rank + 1)

        for rank, doc_id in enumerate(sorted_dense):
            rrf_scores[doc_id] = rrf_scores.get(doc_id, 0.0) + (1.0 - self.alpha) / (rrf_k + rank + 1)

        final_ranked = sorted(
            [doc_id for doc_id, s in rrf_scores.items() if s > 0],
            key=lambda d: rrf_scores[d],
            reverse=True,
        )

        return [self._documents[doc_id] for doc_id in final_ranked[:max_segments]]


class NoOpRetriever:
    """Retriever that returns no results - for testing or when RAG is disabled."""

    async def retrieve_evidence(
        self,
        request: BariChatRequest,
        max_segments: int = 5,
    ) -> list[SourceSegment]:
        return []
