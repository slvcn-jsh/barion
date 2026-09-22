from __future__ import annotations

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


class BM25Retriever:
    """Simple BM25-based text retrieval without vector embeddings.
    
    Ranks source segments by keyword relevance to user query.
    Production version should use semantic embeddings.
    """
    
    def __init__(self, k1: float = 1.5, b: float = 0.75):
        self.k1 = k1
        self.b = b
        # In-memory document store - will be replaced with DB queries
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
            for token in re.findall(r'\b\w+\b', text)
            if len(token) > 2  # Filter short tokens
        ]
    
    def _compute_idf(self) -> None:
        """Compute IDF scores for all terms."""
        import math
        
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
    
    def _bm25_score(self, query_tokens: list[str], doc_id: str) -> float:
        """Calculate BM25 score for a document."""
        segment = self._documents[doc_id]
        doc_tokens = self._tokenize(segment.text)
        doc_length = self._doc_lengths[doc_id]
        
        query_term_counts = Counter(query_tokens)
        doc_term_counts = Counter(doc_tokens)
        
        score = 0.0
        for term, query_count in query_term_counts.items():
            if term not in doc_term_counts:
                continue
            
            idf = self._idf_cache.get(term, 0.0)
            tf = doc_term_counts[term]
            
            # BM25 formula
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
        
        # Score all documents
        scored_docs = [
            (doc_id, self._bm25_score(query_tokens, doc_id))
            for doc_id in self._documents
        ]
        
        # Sort by score descending
        scored_docs.sort(key=lambda x: x[1], reverse=True)
        
        # Return top-k segments
        top_doc_ids = [doc_id for doc_id, score in scored_docs if score > 0][:max_segments]
        return [self._documents[doc_id] for doc_id in top_doc_ids]


class NoOpRetriever:
    """Retriever that returns no results - for testing or when RAG is disabled."""
    
    async def retrieve_evidence(
        self,
        request: BariChatRequest,
        max_segments: int = 5,
    ) -> list[SourceSegment]:
        return []
