/**
 * RAG (Retrieval-Augmented Generation) Module
 *
 * Provides codebase indexing and semantic search capabilities:
 * - AST-based TypeScript parsing
 * - Semantic chunking with overlap
 * - Vector similarity search
 * - LLM-based reranking
 * - Answer generation with source attribution
 */

// Types
export type {
  CodeChunk,
  ChunkMetadata,
  SearchResult,
  RAGConfig,
  RAGQueryResult,
} from "./types.js";
export { ChunkTypeSchema, RAGConfigSchema } from "./types.js";

// Parser
export { parseTypeScriptFile, findTypeScriptFiles } from "./parser.js";
export type { ParsedEntity } from "./parser.js";

// Chunker
export { chunkEntities, chunkCodebase, estimateTokens } from "./chunker.js";

// Store
export { CodeVectorStore } from "./store.js";

// Retriever
export { rerankWithLLM, resolveParentChunks } from "./retriever.js";

// Pipeline
export { RAGPipeline } from "./pipeline.js";
