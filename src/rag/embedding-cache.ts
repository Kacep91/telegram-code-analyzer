/**
 * LRU-style cache for embedding results
 *
 * Caches embedding results to avoid redundant API calls for identical queries.
 * Uses SHA256 hashing for cache keys and LRU eviction when capacity is reached.
 */
import { createHash } from "crypto";
import type { LLMEmbeddingProvider, EmbeddingResult } from "../llm/types.js";

export class EmbeddingCache {
  private readonly cache = new Map<string, EmbeddingResult>();
  private readonly maxSize: number;
  /** In-flight requests to prevent duplicate API calls */
  private readonly pending = new Map<string, Promise<EmbeddingResult>>();
  /** Cache hit count for metrics */
  private hits = 0;
  /** Cache miss count for metrics */
  private misses = 0;

  constructor(maxSize = 1000) {
    this.maxSize = maxSize;
  }

  private hash(text: string): string {
    // Use full SHA256 hash to prevent collisions
    return createHash("sha256").update(text).digest("hex");
  }

  /**
   * Get embedding from cache or compute it (with single-flight deduplication)
   * @param text - Text to embed
   * @param provider - Embedding provider
   * @returns Embedding result
   */
  async getOrEmbed(
    text: string,
    provider: LLMEmbeddingProvider
  ): Promise<EmbeddingResult> {
    const key = this.hash(text);

    // Check completed cache first
    const cached = this.cache.get(key);
    if (cached) {
      // LRU: move to end
      this.cache.delete(key);
      this.cache.set(key, cached);
      this.hits++;
      return cached;
    }

    // Check for in-flight request (single-flight pattern)
    const pending = this.pending.get(key);
    if (pending) {
      this.hits++; // Count as hit since we're reusing work
      return pending;
    }

    // Start new request
    this.misses++;
    const promise = provider.embed(text);
    this.pending.set(key, promise);

    try {
      const result = await promise;

      // LRU eviction if needed
      if (this.cache.size >= this.maxSize) {
        const firstKey = this.cache.keys().next().value;
        if (firstKey) this.cache.delete(firstKey);
      }

      this.cache.set(key, result);
      return result;
    } finally {
      this.pending.delete(key);
    }
  }

  clear(): void {
    this.cache.clear();
    this.pending.clear();
    this.hits = 0;
    this.misses = 0;
  }

  /**
   * Get cache statistics
   */
  getStats(): { size: number; hits: number; misses: number; hitRate: number } {
    const total = this.hits + this.misses;
    return {
      size: this.cache.size,
      hits: this.hits,
      misses: this.misses,
      hitRate: total > 0 ? this.hits / total : 0,
    };
  }

  get size(): number {
    return this.cache.size;
  }
}
