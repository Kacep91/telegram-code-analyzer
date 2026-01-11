import { readFile, writeFile, mkdir, access } from "fs/promises";
import { dirname } from "path";
import type { CodeChunk, ChunkMetadata, SearchResult, FileManifest } from "./types.js";
import {
  validatePathWithinBase,
  getAllowedBasePath,
} from "../cli/path-validator.js";
import { logger } from "../utils.js";

/** Threshold for detecting zero/near-zero vectors during normalization */
const ZERO_VECTOR_THRESHOLD = 1e-10;

/** Stored chunk with embedding */
interface StoredChunk {
  readonly chunk: CodeChunk;
  readonly embedding: readonly number[];
}

/** Serialized store format for persistence */
interface SerializedStore {
  readonly metadata: ChunkMetadata;
  readonly chunks: readonly StoredChunk[];
  readonly embeddingDimension: number;
  readonly manifest?: FileManifest;
}

/**
 * In-memory vector store for code chunks
 * Uses brute-force cosine similarity (IndexFlatIP equivalent)
 *
 * @remarks Can be replaced with FAISS for large codebases (>10k chunks)
 */
export class CodeVectorStore {
  private chunks: StoredChunk[] = [];
  private chunkIdIndex: Map<string, number> = new Map();
  private metadata: ChunkMetadata | null = null;
  private embeddingDimension: number = 0;
  private filePathIndex: Map<string, Set<string>> = new Map();
  private manifest: FileManifest | null = null;

  /**
   * Add chunks with their embeddings
   * @param chunks - Code chunks to add
   * @param embeddings - Corresponding embeddings (same order)
   * @throws Error if arrays have different lengths or dimension mismatch
   */
  addChunks(
    chunks: readonly CodeChunk[],
    embeddings: readonly (readonly number[])[]
  ): void {
    if (chunks.length !== embeddings.length) {
      throw new Error(
        `Chunks and embeddings arrays must have same length: ${chunks.length} vs ${embeddings.length}`
      );
    }

    if (chunks.length === 0) return;

    // Get first embedding to check dimension
    const firstEmbedding = embeddings[0];
    if (!firstEmbedding) return;

    const dim = firstEmbedding.length;
    if (dim === 0) {
      throw new Error("Embedding dimension cannot be 0");
    }

    // Determine expected dimension for validation
    const expectedDimension = this.embeddingDimension === 0 ? dim : this.embeddingDimension;

    // Validate dimension mismatch with existing store
    if (this.embeddingDimension !== 0 && dim !== this.embeddingDimension) {
      throw new Error(
        `Embedding dimension mismatch: expected ${this.embeddingDimension}, got ${dim}`
      );
    }

    // Phase 1: Validate ALL embeddings BEFORE modifying state
    for (let i = 0; i < embeddings.length; i++) {
      const embedding = embeddings[i];
      if (!embedding) continue;

      if (embedding.length !== expectedDimension) {
        throw new Error(
          `Embedding at index ${i} has wrong dimension: expected ${expectedDimension}, got ${embedding.length}`
        );
      }
    }

    // Phase 2: Now safe to set dimension and add chunks
    if (this.embeddingDimension === 0) {
      this.embeddingDimension = dim;
    }

    // Normalize and store
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const embedding = embeddings[i];

      if (!chunk || !embedding) continue;

      // Check for duplicate chunk ID
      if (this.chunkIdIndex.has(chunk.id)) {
        logger.warn(`[VectorStore] Duplicate chunk ID ignored: ${chunk.id}`);
        continue;
      }

      const normalized = this.normalizeVector(embedding);
      const index = this.chunks.length;

      this.chunks.push({ chunk, embedding: normalized });
      this.chunkIdIndex.set(chunk.id, index);

      // Update filePathIndex
      if (!this.filePathIndex.has(chunk.filePath)) {
        this.filePathIndex.set(chunk.filePath, new Set());
      }
      this.filePathIndex.get(chunk.filePath)!.add(chunk.id);
    }
  }

  /**
   * Search for similar chunks using cosine similarity
   * @param queryEmbedding - Query vector
   * @param topK - Number of results to return
   * @returns Search results sorted by similarity (highest first)
   */
  search(
    queryEmbedding: readonly number[],
    topK: number
  ): readonly SearchResult[] {
    if (this.chunks.length === 0) {
      return [];
    }

    if (queryEmbedding.length !== this.embeddingDimension) {
      throw new Error(
        `Query embedding dimension mismatch: expected ${this.embeddingDimension}, got ${queryEmbedding.length}`
      );
    }

    const normalizedQuery = this.normalizeVector(queryEmbedding);

    // Calculate cosine similarity for all chunks
    const scored: Array<{ chunk: CodeChunk; score: number }> = [];

    for (const stored of this.chunks) {
      const score = this.dotProduct(normalizedQuery, stored.embedding);
      scored.push({ chunk: stored.chunk, score });
    }

    // Sort by score descending and take topK
    scored.sort((a, b) => b.score - a.score);

    const results: SearchResult[] = [];
    const limit = Math.min(topK, scored.length);

    for (let i = 0; i < limit; i++) {
      const item = scored[i];
      if (!item) continue;

      results.push({
        chunk: item.chunk,
        vectorScore: item.score,
        finalScore: item.score, // Will be updated by reranker
      });
    }

    return results;
  }

  /**
   * Get chunk by ID
   * @param id - Chunk ID
   * @returns Code chunk or undefined if not found
   */
  getChunkById(id: string): CodeChunk | undefined {
    const index = this.chunkIdIndex.get(id);
    if (index === undefined) return undefined;

    const stored = this.chunks[index];
    return stored?.chunk;
  }

  /**
   * Remove chunks by their IDs
   * @param ids - Array of chunk IDs to remove
   * @returns Number of chunks actually removed
   */
  removeChunks(ids: readonly string[]): number {
    const idsToRemove = new Set(ids);
    const originalLength = this.chunks.length;

    // Remove from filePathIndex
    for (const id of idsToRemove) {
      const index = this.chunkIdIndex.get(id);
      if (index !== undefined) {
        const chunk = this.chunks[index]?.chunk;
        if (chunk) {
          const fileChunks = this.filePathIndex.get(chunk.filePath);
          if (fileChunks) {
            fileChunks.delete(id);
            if (fileChunks.size === 0) {
              this.filePathIndex.delete(chunk.filePath);
            }
          }
        }
      }
    }

    // Filter out chunks to remove
    this.chunks = this.chunks.filter(
      (stored) => !idsToRemove.has(stored.chunk.id)
    );

    // Rebuild index
    this.chunkIdIndex.clear();
    for (let i = 0; i < this.chunks.length; i++) {
      const stored = this.chunks[i];
      if (stored) {
        this.chunkIdIndex.set(stored.chunk.id, i);
      }
    }

    return originalLength - this.chunks.length;
  }

  /**
   * Get all chunks (for iteration)
   * @returns Readonly array of code chunks
   */
  getAllChunks(): readonly CodeChunk[] {
    return this.chunks.map((stored) => stored.chunk);
  }

  /**
   * Set store metadata
   */
  setMetadata(metadata: ChunkMetadata): void {
    this.metadata = metadata;
  }

  /**
   * Get store metadata
   */
  getMetadata(): ChunkMetadata | null {
    return this.metadata;
  }

  /**
   * Set file manifest for incremental indexing
   */
  setManifest(manifest: FileManifest): void {
    this.manifest = manifest;
  }

  /**
   * Get file manifest
   */
  getManifest(): FileManifest | null {
    return this.manifest;
  }

  /**
   * Remove all chunks belonging to a specific file
   * @param filePath - Path of the file whose chunks should be removed
   * @returns Number of chunks removed
   */
  removeChunksByFile(filePath: string): number {
    const chunkIds = this.getChunkIdsByFile(filePath);
    if (chunkIds.length === 0) return 0;
    return this.removeChunks(chunkIds);
  }

  /**
   * Get chunk count
   */
  size(): number {
    return this.chunks.length;
  }

  /**
   * Get embedding dimension (0 if no chunks added)
   */
  getEmbeddingDimension(): number {
    return this.embeddingDimension;
  }

  /**
   * Check if store is empty
   */
  isEmpty(): boolean {
    return this.chunks.length === 0;
  }

  /**
   * Get all chunk IDs for a specific file
   * @param filePath - Path of the file
   * @returns Array of chunk IDs belonging to this file
   */
  getChunkIdsByFile(filePath: string): readonly string[] {
    const ids = this.filePathIndex.get(filePath);
    return ids ? [...ids] : [];
  }

  /**
   * Clear all chunks
   */
  clear(): void {
    this.chunks = [];
    this.chunkIdIndex.clear();
    this.filePathIndex.clear();
    this.metadata = null;
    this.embeddingDimension = 0;
    this.manifest = null;
  }

  /**
   * Save store to disk with path validation
   * @param path - File path for the store (must be within allowed directory)
   * @param compress - Whether to minify JSON output (default: false)
   * @throws Error if path is outside allowed directory
   */
  async save(path: string, compress: boolean = false): Promise<void> {
    if (!this.metadata) {
      throw new Error("Cannot save store without metadata");
    }

    // Validate path is within allowed directory
    const basePath = getAllowedBasePath();
    await validatePathWithinBase(path, basePath);

    const serialized: SerializedStore = {
      metadata: this.metadata,
      chunks: this.chunks,
      embeddingDimension: this.embeddingDimension,
      ...(this.manifest && { manifest: this.manifest }),
    };

    await mkdir(dirname(path), { recursive: true });

    const content = compress
      ? JSON.stringify(serialized)
      : JSON.stringify(serialized, null, 2);

    await writeFile(path, content, "utf-8");
  }

  /**
   * Load store from disk with path validation
   * @param path - File path to load from (must be within allowed directory)
   * @throws Error if file doesn't exist, has invalid format, or path is outside allowed directory
   */
  async load(path: string): Promise<void> {
    // Validate path is within allowed directory
    const basePath = getAllowedBasePath();
    const validatedPath = await validatePathWithinBase(path, basePath);

    const content = await readFile(validatedPath, "utf-8");
    const parsed: unknown = JSON.parse(content);

    // Validate structure
    if (!this.isSerializedStore(parsed)) {
      throw new Error("Invalid store format");
    }

    this.metadata = parsed.metadata;
    this.chunks = parsed.chunks.map((c) => ({
      chunk: c.chunk,
      embedding: c.embedding,
    }));
    this.embeddingDimension = parsed.embeddingDimension;
    this.manifest = parsed.manifest ?? null;

    // Rebuild chunkIdIndex and filePathIndex
    this.chunkIdIndex.clear();
    this.filePathIndex.clear();
    for (let i = 0; i < this.chunks.length; i++) {
      const stored = this.chunks[i];
      if (stored) {
        this.chunkIdIndex.set(stored.chunk.id, i);

        // Rebuild filePathIndex
        const filePath = stored.chunk.filePath;
        if (!this.filePathIndex.has(filePath)) {
          this.filePathIndex.set(filePath, new Set());
        }
        this.filePathIndex.get(filePath)!.add(stored.chunk.id);
      }
    }
  }

  /**
   * Check if store exists on disk
   * @param path - File path to check
   */
  static async exists(path: string): Promise<boolean> {
    try {
      await access(path);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Type guard for serialized store validation
   */
  private isSerializedStore(value: unknown): value is SerializedStore {
    if (typeof value !== "object" || value === null) return false;

    const obj = value as Record<string, unknown>;

    // Check required fields
    if (typeof obj["metadata"] !== "object" || obj["metadata"] === null)
      return false;
    if (!Array.isArray(obj["chunks"])) return false;
    if (typeof obj["embeddingDimension"] !== "number") return false;

    // Validate metadata structure
    const meta = obj["metadata"] as Record<string, unknown>;
    if (typeof meta["projectPath"] !== "string") return false;
    if (typeof meta["totalChunks"] !== "number") return false;
    if (typeof meta["totalTokens"] !== "number") return false;
    if (typeof meta["indexedAt"] !== "string") return false;
    if (typeof meta["version"] !== "string") return false;

    // Validate manifest if present (optional for backward compatibility)
    if (obj["manifest"] !== undefined) {
      const manifest = obj["manifest"];
      if (typeof manifest !== "object" || manifest === null) return false;
      const m = manifest as Record<string, unknown>;
      if (typeof m["files"] !== "object" || m["files"] === null) return false;
      if (typeof m["version"] !== "string") return false;
    }

    return true;
  }

  /**
   * Normalize vector to unit length for cosine similarity
   * @param vec - Input vector
   * @returns Normalized vector with magnitude 1, or zero vector if input is zero/near-zero
   */
  private normalizeVector(vec: readonly number[]): readonly number[] {
    let sumSquares = 0;
    for (const val of vec) {
      sumSquares += val * val;
    }

    const magnitude = Math.sqrt(sumSquares);

    // Zero or near-zero vectors cannot be normalized meaningfully
    // Return zero vector of same dimension - will result in 0 similarity score
    if (magnitude < ZERO_VECTOR_THRESHOLD) {
      logger.warn("[VectorStore] Attempted to normalize zero/near-zero vector");
      return vec.map(() => 0);
    }

    return vec.map((val) => val / magnitude);
  }

  /**
   * Calculate dot product of two vectors
   * @param a - First vector
   * @param b - Second vector
   * @returns Dot product (cosine similarity for normalized vectors)
   * @throws Error if vector dimensions don't match
   */
  private dotProduct(a: readonly number[], b: readonly number[]): number {
    if (a.length !== b.length) {
      throw new Error(`Vector dimension mismatch: ${a.length} vs ${b.length}`);
    }

    let sum = 0;
    for (let i = 0; i < a.length; i++) {
      sum += (a[i] ?? 0) * (b[i] ?? 0);
    }

    return sum;
  }
}
