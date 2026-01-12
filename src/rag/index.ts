/**
 * RAG (Retrieval-Augmented Generation) Module
 *
 * Provides codebase indexing and semantic search capabilities:
 * - AST-based TypeScript parsing
 * - Semantic chunking with overlap
 * - Vector similarity search
 * - LLM-based reranking
 * - Answer generation with source attribution
 * - Documentation indexing from ai-docs/
 */

// Types
export type {
  CodeChunk,
  ChunkMetadata,
  SearchResult,
  RAGConfig,
  RAGQueryResult,
  DocType,
  ProgressCallback,
} from "./types.js";
export { ChunkTypeSchema, RAGConfigSchema, DocTypeSchema } from "./types.js";

// Code Parser
export { parseTypeScriptFile, findTypeScriptFiles } from "./parser.js";
export type { ParsedEntity } from "./parser.js";

// Documentation Parser
export {
  parseMarkdownFile,
  findDocumentFiles,
  detectDocumentType,
} from "./doc-parser.js";
export type { ParsedDocument, DocSection } from "./doc-parser.js";

// Chunker
export {
  chunkEntities,
  chunkCodebase,
  chunkDocumentSections,
  estimateTokens,
} from "./chunker.js";

// Store
export { CodeVectorStore } from "./store.js";

// Retriever
export { rerankWithLLM, resolveParentChunks } from "./retriever.js";

// Pipeline
export { RAGPipeline } from "./pipeline.js";

// Cache
export { EmbeddingCache } from "./embedding-cache.js";
