# Bari Chat RAG Retrieval Integration

## Completed: Step 1 - RAG Retrieval Layer

### Implementation

Built BM25-based text retrieval system for auto-populating evidence in Bari chat conversations.

### Components Added

**1. Retrieval Module (`retrieval.py`)**
- `SourceRetriever` protocol for pluggable retrieval backends
- `BM25Retriever`: Keyword-based ranking using BM25 algorithm
  - Tokenization with stopword filtering (>2 chars)
  - IDF computation across document corpus
  - Configurable parameters (k1=1.5, b=0.75)
- `NoOpRetriever`: Fallback when RAG disabled

**2. Orchestration Integration**
- `GenerationOrchestrator` accepts optional `retriever` parameter
- Auto-retrieves evidence when `request.evidence` empty
- Passes retrieved segments to provider
- Returns evidence in response for frontend citation display

**3. Test Coverage (`test_retrieval.py`)**
- 8 tests covering:
  - Basic retrieval and keyword matching
  - Empty document/query handling
  - Max segments limit enforcement
  - Tokenization behavior
  - Scoring relevance

### Architecture

```
┌─────────────────────┐
│ BariChatRequest     │
│ (no evidence)       │
└──────────┬──────────┘
           │
           v
┌─────────────────────┐
│ Orchestrator        │
│ - Check evidence    │
│ - Auto-retrieve     │
└──────────┬──────────┘
           │
           v
┌─────────────────────┐
│ BM25Retriever       │
│ - Tokenize query    │
│ - Score documents   │
│ - Rank top-k        │
└──────────┬──────────┘
           │
           v
┌─────────────────────┐
│ Provider (Gemini)   │
│ - Inject evidence   │
│ - Generate response │
└──────────┬──────────┘
           │
           v
┌─────────────────────┐
│ BariChatResponse    │
│ + evidence          │
│ + citations         │
└─────────────────────┘
```

### Current Limitations

**In-Memory Document Store**
- `BM25Retriever` indexes segments in memory
- Production needs database query integration
- No filtering by `documentIds`, `courseId`, or `deckId` yet

**Keyword-Based Ranking**
- BM25 uses lexical matching, not semantic similarity
- Misses synonyms and conceptual relationships
- Production should use embeddings (Gemini Embedding API)

**No Persistence**
- Index rebuilt on each indexing call
- Should integrate with database vector store

### Usage Example

```python
from retrieval import BM25Retriever
from orchestration import GenerationOrchestrator
from providers.gemini import GeminiGenerationProvider

# Setup retriever with source segments
retriever = BM25Retriever()
retriever.index_segments([
    SourceSegment(
        segmentId="seg-123",
        locator="Lecture 3, Slide 12",
        sectionPath="Cardiovascular > Heart Failure",
        text="ACE inhibitors reduce mortality in heart failure...",
    ),
    # ... more segments
])

# Create orchestrator with retrieval
provider = GeminiGenerationProvider(api_key, model, timeout)
orchestrator = GenerationOrchestrator(provider, retriever)

# Chat without evidence - auto-retrieves
response = await orchestrator.bari_chat(BariChatRequest(
    message="What medications treat heart failure?",
    mode="source-strict",
    # evidence=[]  # Empty - will auto-retrieve
))

# Response contains retrieved evidence + citations
assert len(response.evidence) > 0
assert len(response.citations) > 0
```

### Integration with Frontend

Frontend needs to:
1. **Maintain conversationId** for multi-turn conversations
2. **Display retrieved evidence** from `response.evidence`
3. **Render citations** inline with `response.citations`
4. **Optionally pre-populate evidence** to override auto-retrieval

### Next Steps

**Immediate (Production Ready):**
1. Database integration - query segments by scope filters
2. Index pre-computation - avoid re-indexing on every request
3. Semantic embeddings - replace BM25 with vector similarity

**Follow-On (Feature Complete):**
1. Frontend chat UI component
2. Conversation persistence (database/Redis)
3. Streaming responses (SSE)
4. Advanced retrieval: reranking, hybrid search, query expansion

### Test Results

All tests passing:
- 8 retrieval tests ✓
- 24 gateway tests (including Bari chat) ✓

### Files Changed

- `services/ai_gateway/retrieval.py` - New
- `services/ai_gateway/orchestration.py` - Updated
- `services/ai_gateway/tests/test_retrieval.py` - New
- `services/ai_gateway/requirements.txt` - Added pytest-asyncio
- `services/ai_gateway/pytest.ini` - New

---

**Status:** RAG retrieval layer complete and tested. Ready for database integration + semantic embeddings upgrade.
