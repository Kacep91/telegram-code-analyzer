---
type: adr
status: accepted
date: 2024-01-10
---

# ADR-001: Use Jina for Code Embeddings

## Status

Accepted

## Context

RAG system needs an embedding provider. Options considered:

| Provider | Model | Dimensions | Code Optimized |
|----------|-------|------------|----------------|
| OpenAI | text-embedding-3-large | 3072 | No |
| Gemini | text-embedding-004 | 768 | No |
| Jina | jina-embeddings-v3 | 768 | Yes |

## Decision

Selected **Jina AI** as the priority embedding provider:

1. Model `jina-embeddings-v3` is specifically optimized for code
2. Smaller dimensions (768) reduce memory consumption
3. Competitive pricing compared to OpenAI

Fallback order: Jina → OpenAI → Gemini

## Consequences

### Positive

- Better code search quality
- Smaller index size
- Faster cosine similarity (fewer dimensions)

### Negative

- Additional dependency on Jina API
- Requires separate API key (JINA_API_KEY)

## Implementation

```typescript
// src/llm/index.ts
getEmbeddingProvider(config) → fallback order:
  1. Jina (if JINA_API_KEY is set)
  2. OpenAI (if OPENAI_API_KEY is set)
  3. Gemini (if GEMINI_API_KEY is set)
```
