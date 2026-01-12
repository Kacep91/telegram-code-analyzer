import { z } from "zod";

// Chunk types (AST-based for code, doc-based for documentation)
export const ChunkTypeSchema = z.enum([
  // Code entities
  "function",
  "class",
  "interface",
  "type",
  "constant",
  "file",
  // Documentation entities
  "doc_section",
  "doc_prd",
  "doc_adr",
  "doc_api",
  "doc_notes",
]);
export type ChunkType = z.infer<typeof ChunkTypeSchema>;

// Document types for ai-docs/
export const DocTypeSchema = z.enum(["prd", "adr", "api", "notes"]);
export type DocType = z.infer<typeof DocTypeSchema>;

// Code chunk (also used for documentation chunks)
export interface CodeChunk {
  readonly id: string;
  readonly content: string;
  readonly type: ChunkType;
  readonly name: string;
  readonly filePath: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly parentId?: string; // For parent retrieval
  readonly tokenCount: number;
  readonly docType?: DocType; // Only for documentation chunks from ai-docs/
}

// Index metadata
export interface ChunkMetadata {
  readonly projectPath: string;
  readonly totalChunks: number;
  readonly totalTokens: number;
  readonly indexedAt: string;
  readonly version: string;
}

// Search result
export interface SearchResult {
  readonly chunk: CodeChunk;
  readonly vectorScore: number;
  readonly llmScore?: number;
  readonly finalScore: number;
}

/**
 * RAG configuration schema with validation constraints
 * @remarks Based on RAG Challenge article best practices
 *
 * Constraints:
 * - vectorWeight + llmWeight must equal 1.0
 * - chunkOverlap must be less than chunkSize
 * - rerankTopK must be <= topK
 */
export const RAGConfigSchema = z
  .object({
    /** Maximum tokens per chunk */
    chunkSize: z.number().positive().default(300),
    /** Overlap tokens between chunks */
    chunkOverlap: z.number().nonnegative().default(50),
    /** Number of candidates for vector search */
    topK: z.number().positive().default(10),
    /** Number of results after reranking */
    rerankTopK: z.number().positive().default(5),
    /** Weight for vector similarity score (0-1) */
    vectorWeight: z.number().min(0).max(1).default(0.3),
    /** Weight for LLM reranking score (0-1) */
    llmWeight: z.number().min(0).max(1).default(0.7),
  })
  .refine((data) => Math.abs(data.vectorWeight + data.llmWeight - 1) < 0.001, {
    message: "vectorWeight + llmWeight must equal 1.0",
  })
  .refine((data) => data.chunkOverlap < data.chunkSize, {
    message: "chunkOverlap must be less than chunkSize",
  })
  .refine((data) => data.rerankTopK <= data.topK, {
    message: "rerankTopK must be <= topK",
  });
export type RAGConfig = z.infer<typeof RAGConfigSchema>;

// Query result
export interface RAGQueryResult {
  readonly answer: string;
  readonly sources: readonly SearchResult[];
  readonly tokenCount: number;
}

// ============================================================================
// Incremental Indexing Types
// ============================================================================

/** File entry in manifest for incremental indexing */
export interface FileEntry {
  /** SHA256 hash of file content */
  readonly contentHash: string;
  /** Chunk IDs generated from this file */
  readonly chunkIds: readonly string[];
  /** File modification time in ms (for quick pre-check) */
  readonly mtime: number;
}

/** Manifest tracking files and their chunks for incremental indexing */
export interface FileManifest {
  /** Map: filePath → FileEntry */
  readonly files: Readonly<Record<string, FileEntry>>;
  /** Manifest version for compatibility */
  readonly version: string;
}

// ============================================================================
// Zod Schemas for Disk Persistence Validation
// ============================================================================

/** Zod schema for FileEntry validation when loading from disk */
export const FileEntrySchema = z.object({
  contentHash: z.string(),
  chunkIds: z.array(z.string()).readonly(),
  mtime: z.number(),
});

/** Zod schema for FileManifest validation when loading from disk */
export const FileManifestSchema = z.object({
  files: z.record(z.string(), FileEntrySchema),
  version: z.string(),
});

/** Result of incremental indexing */
export interface IncrementalIndexResult {
  readonly metadata: ChunkMetadata;
  readonly stats: {
    readonly added: number;
    readonly modified: number;
    readonly deleted: number;
    readonly unchanged: number;
  };
}

/** Detected file changes for incremental indexing */
export interface FileChanges {
  /** New files to index */
  readonly added: readonly string[];
  /** Modified files (content hash changed) */
  readonly modified: readonly string[];
  /** Deleted files (in manifest but not on disk) */
  readonly deleted: readonly string[];
  /** Unchanged files */
  readonly unchanged: readonly string[];
}

/** Manifest version for incremental indexing compatibility */
export const MANIFEST_VERSION = "1.0.0";

/**
 * Progress callback for long-running indexing operations
 * @param current - Current item number
 * @param total - Total items to process
 * @param stage - Description of current stage
 */
export type ProgressCallback = (
  current: number,
  total: number,
  stage: string
) => void | Promise<void>;
