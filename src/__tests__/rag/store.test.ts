/**
 * Unit tests for CodeVectorStore
 * Tests vector storage, search, persistence and edge cases
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { CodeVectorStore } from "../../rag/store.js";
import type { CodeChunk, ChunkMetadata } from "../../rag/types.js";

// Mock fs/promises
vi.mock("fs/promises", () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
  access: vi.fn(),
}));

// Mock path-validator
vi.mock("../../cli/path-validator.js", () => ({
  validatePathWithinBase: vi
    .fn()
    .mockImplementation((path: string) => Promise.resolve(path)),
  getAllowedBasePath: vi.fn().mockReturnValue("/allowed/base"),
}));

// Import mocked modules
import { readFile, writeFile, mkdir, access } from "fs/promises";
import {
  validatePathWithinBase,
  getAllowedBasePath,
} from "../../cli/path-validator.js";

// Helper to create test chunks
function createTestChunk(overrides: Partial<CodeChunk> = {}): CodeChunk {
  return {
    id: overrides.id ?? "chunk-1",
    content: overrides.content ?? "function test() { return 42; }",
    type: overrides.type ?? "function",
    name: overrides.name ?? "test",
    filePath: overrides.filePath ?? "/src/test.ts",
    startLine: overrides.startLine ?? 1,
    endLine: overrides.endLine ?? 3,
    tokenCount: overrides.tokenCount ?? 10,
    ...overrides,
  };
}

// Helper to create test metadata
function createTestMetadata(
  overrides: Partial<ChunkMetadata> = {}
): ChunkMetadata {
  return {
    projectPath: overrides.projectPath ?? "/test/project",
    totalChunks: overrides.totalChunks ?? 1,
    totalTokens: overrides.totalTokens ?? 100,
    indexedAt: overrides.indexedAt ?? new Date().toISOString(),
    version: overrides.version ?? "1.0.0",
    ...overrides,
  };
}

describe("CodeVectorStore", () => {
  let store: CodeVectorStore;

  beforeEach(() => {
    store = new CodeVectorStore();
    vi.clearAllMocks();

    // Re-setup mocks after clearAllMocks
    vi.mocked(validatePathWithinBase).mockImplementation((path: string) =>
      Promise.resolve(path)
    );
    vi.mocked(getAllowedBasePath).mockReturnValue("/allowed/base");
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe("Constructor", () => {
    it("should create empty store", () => {
      const newStore = new CodeVectorStore();

      expect(newStore.isEmpty()).toBe(true);
      expect(newStore.size()).toBe(0);
      expect(newStore.getMetadata()).toBeNull();
      expect(newStore.getEmbeddingDimension()).toBe(0);
    });
  });

  describe("addChunks", () => {
    it("should add valid chunks with embeddings", () => {
      const chunks = [
        createTestChunk({ id: "chunk-1" }),
        createTestChunk({ id: "chunk-2" }),
      ];
      const embeddings = [
        [0.1, 0.2, 0.3],
        [0.4, 0.5, 0.6],
      ];

      store.addChunks(chunks, embeddings);

      expect(store.size()).toBe(2);
      expect(store.isEmpty()).toBe(false);
      expect(store.getEmbeddingDimension()).toBe(3);
    });

    it("should throw error when chunks and embeddings arrays have different lengths", () => {
      const chunks = [
        createTestChunk({ id: "chunk-1" }),
        createTestChunk({ id: "chunk-2" }),
      ];
      const embeddings = [[0.1, 0.2, 0.3]]; // Only one embedding

      expect(() => store.addChunks(chunks, embeddings)).toThrow(
        "Chunks and embeddings arrays must have same length: 2 vs 1"
      );
    });

    it("should throw error on embedding dimension mismatch", () => {
      // First add chunks with 3D embeddings
      const chunks1 = [createTestChunk({ id: "chunk-1" })];
      const embeddings1 = [[0.1, 0.2, 0.3]];
      store.addChunks(chunks1, embeddings1);

      // Then try to add with 4D embeddings
      const chunks2 = [createTestChunk({ id: "chunk-2" })];
      const embeddings2 = [[0.1, 0.2, 0.3, 0.4]];

      expect(() => store.addChunks(chunks2, embeddings2)).toThrow(
        "Embedding dimension mismatch: expected 3, got 4"
      );
    });

    it("should throw error when embedding has zero dimension", () => {
      const chunks = [createTestChunk({ id: "chunk-1" })];
      const embeddings: number[][] = [[]]; // Empty embedding

      expect(() => store.addChunks(chunks, embeddings)).toThrow(
        "Embedding dimension cannot be 0"
      );
    });

    it("should throw error when individual embedding has wrong dimension", () => {
      const chunks = [
        createTestChunk({ id: "chunk-1" }),
        createTestChunk({ id: "chunk-2" }),
      ];
      const embeddings = [
        [0.1, 0.2, 0.3],
        [0.1, 0.2], // Wrong dimension
      ];

      expect(() => store.addChunks(chunks, embeddings)).toThrow(
        "Embedding at index 1 has wrong dimension: expected 3, got 2"
      );
    });

    it("should handle empty arrays gracefully", () => {
      store.addChunks([], []);

      expect(store.isEmpty()).toBe(true);
      expect(store.size()).toBe(0);
    });
  });

  describe("search", () => {
    it("should return empty array when store is empty", () => {
      const queryEmbedding = [0.1, 0.2, 0.3];

      const results = store.search(queryEmbedding, 5);

      expect(results).toEqual([]);
    });

    it("should return results sorted by score in descending order", () => {
      // Add chunks with known embeddings
      const chunks = [
        createTestChunk({ id: "low-similarity", name: "low" }),
        createTestChunk({ id: "high-similarity", name: "high" }),
        createTestChunk({ id: "medium-similarity", name: "medium" }),
      ];
      // Embeddings normalized for cosine similarity
      const embeddings = [
        [0.0, 1.0, 0.0], // Orthogonal to query
        [1.0, 0.0, 0.0], // Same direction as query
        [0.707, 0.707, 0.0], // 45 degrees to query
      ];

      store.addChunks(chunks, embeddings);

      const queryEmbedding = [1.0, 0.0, 0.0]; // Same as high-similarity
      const results = store.search(queryEmbedding, 3);

      expect(results.length).toBe(3);
      expect(results[0]?.chunk.id).toBe("high-similarity");
      expect(results[1]?.chunk.id).toBe("medium-similarity");
      expect(results[2]?.chunk.id).toBe("low-similarity");

      // Verify scores are descending
      expect(results[0]?.vectorScore).toBeGreaterThan(
        results[1]?.vectorScore ?? 0
      );
      expect(results[1]?.vectorScore).toBeGreaterThan(
        results[2]?.vectorScore ?? 0
      );
    });

    it("should throw error on query dimension mismatch", () => {
      const chunks = [createTestChunk({ id: "chunk-1" })];
      const embeddings = [[0.1, 0.2, 0.3]];
      store.addChunks(chunks, embeddings);

      const queryEmbedding = [0.1, 0.2]; // Wrong dimension

      expect(() => store.search(queryEmbedding, 5)).toThrow(
        "Query embedding dimension mismatch: expected 3, got 2"
      );
    });

    it("should return all chunks when topK is larger than chunk count", () => {
      const chunks = [
        createTestChunk({ id: "chunk-1" }),
        createTestChunk({ id: "chunk-2" }),
      ];
      const embeddings = [
        [0.1, 0.2, 0.3],
        [0.4, 0.5, 0.6],
      ];
      store.addChunks(chunks, embeddings);

      const queryEmbedding = [0.1, 0.2, 0.3];
      const results = store.search(queryEmbedding, 100); // topK > chunks.length

      expect(results.length).toBe(2);
    });
  });

  describe("getChunkById", () => {
    it("should return chunk when ID exists", () => {
      const chunk = createTestChunk({
        id: "target-chunk",
        name: "targetFunction",
      });
      store.addChunks([chunk], [[0.1, 0.2, 0.3]]);

      const result = store.getChunkById("target-chunk");

      expect(result).toBeDefined();
      expect(result?.id).toBe("target-chunk");
      expect(result?.name).toBe("targetFunction");
    });

    it("should return undefined when ID does not exist", () => {
      const chunk = createTestChunk({ id: "chunk-1" });
      store.addChunks([chunk], [[0.1, 0.2, 0.3]]);

      const result = store.getChunkById("non-existent-id");

      expect(result).toBeUndefined();
    });
  });

  describe("removeChunks", () => {
    it("should remove existing chunks and return count", () => {
      const chunks = [
        createTestChunk({ id: "chunk-1" }),
        createTestChunk({ id: "chunk-2" }),
        createTestChunk({ id: "chunk-3" }),
      ];
      const embeddings = [
        [0.1, 0.2, 0.3],
        [0.4, 0.5, 0.6],
        [0.7, 0.8, 0.9],
      ];
      store.addChunks(chunks, embeddings);

      const removedCount = store.removeChunks(["chunk-1", "chunk-3"]);

      expect(removedCount).toBe(2);
      expect(store.size()).toBe(1);
      expect(store.getChunkById("chunk-1")).toBeUndefined();
      expect(store.getChunkById("chunk-2")).toBeDefined();
      expect(store.getChunkById("chunk-3")).toBeUndefined();
    });

    it("should handle removing non-existent IDs gracefully (no-op)", () => {
      const chunk = createTestChunk({ id: "chunk-1" });
      store.addChunks([chunk], [[0.1, 0.2, 0.3]]);

      const removedCount = store.removeChunks([
        "non-existent-1",
        "non-existent-2",
      ]);

      expect(removedCount).toBe(0);
      expect(store.size()).toBe(1);
    });
  });

  describe("getAllChunks, size, isEmpty, clear", () => {
    it("should return all chunks via getAllChunks", () => {
      const chunks = [
        createTestChunk({ id: "chunk-1" }),
        createTestChunk({ id: "chunk-2" }),
      ];
      const embeddings = [
        [0.1, 0.2, 0.3],
        [0.4, 0.5, 0.6],
      ];
      store.addChunks(chunks, embeddings);

      const allChunks = store.getAllChunks();

      expect(allChunks.length).toBe(2);
      expect(allChunks[0]?.id).toBe("chunk-1");
      expect(allChunks[1]?.id).toBe("chunk-2");
    });

    it("should return correct size", () => {
      expect(store.size()).toBe(0);

      store.addChunks([createTestChunk({ id: "chunk-1" })], [[0.1, 0.2, 0.3]]);
      expect(store.size()).toBe(1);

      store.addChunks([createTestChunk({ id: "chunk-2" })], [[0.4, 0.5, 0.6]]);
      expect(store.size()).toBe(2);
    });

    it("should return correct isEmpty status", () => {
      expect(store.isEmpty()).toBe(true);

      store.addChunks([createTestChunk({ id: "chunk-1" })], [[0.1, 0.2, 0.3]]);
      expect(store.isEmpty()).toBe(false);
    });

    it("should clear all data", () => {
      const chunks = [createTestChunk({ id: "chunk-1" })];
      const metadata = createTestMetadata();
      store.addChunks(chunks, [[0.1, 0.2, 0.3]]);
      store.setMetadata(metadata);

      store.clear();

      expect(store.isEmpty()).toBe(true);
      expect(store.size()).toBe(0);
      expect(store.getMetadata()).toBeNull();
      expect(store.getEmbeddingDimension()).toBe(0);
    });
  });

  describe("setMetadata, getMetadata", () => {
    it("should set and get metadata correctly", () => {
      const metadata = createTestMetadata({
        projectPath: "/custom/path",
        totalChunks: 42,
        version: "2.0.0",
      });

      store.setMetadata(metadata);

      const result = store.getMetadata();
      expect(result).toEqual(metadata);
      expect(result?.projectPath).toBe("/custom/path");
      expect(result?.totalChunks).toBe(42);
      expect(result?.version).toBe("2.0.0");
    });

    it("should return null when metadata not set", () => {
      expect(store.getMetadata()).toBeNull();
    });
  });

  describe("save", () => {
    it("should save store to JSON file successfully", async () => {
      const chunks = [createTestChunk({ id: "chunk-1" })];
      const metadata = createTestMetadata();
      store.addChunks(chunks, [[0.1, 0.2, 0.3]]);
      store.setMetadata(metadata);

      vi.mocked(mkdir).mockResolvedValue(undefined);
      vi.mocked(writeFile).mockResolvedValue(undefined);

      await store.save("/allowed/base/store.json");

      expect(validatePathWithinBase).toHaveBeenCalledWith(
        "/allowed/base/store.json",
        "/allowed/base"
      );
      expect(mkdir).toHaveBeenCalled();
      expect(writeFile).toHaveBeenCalledWith(
        "/allowed/base/store.json",
        expect.stringContaining('"metadata"'),
        "utf-8"
      );
    });

    it("should throw error when saving without metadata", async () => {
      store.addChunks([createTestChunk({ id: "chunk-1" })], [[0.1, 0.2, 0.3]]);
      // No metadata set

      await expect(store.save("/allowed/base/store.json")).rejects.toThrow(
        "Cannot save store without metadata"
      );
    });

    it("should validate path security before saving", async () => {
      const metadata = createTestMetadata();
      store.setMetadata(metadata);

      vi.mocked(validatePathWithinBase).mockRejectedValue(
        new Error(
          'Path "/outside/base/store.json" resolves outside allowed directory'
        )
      );

      await expect(store.save("/outside/base/store.json")).rejects.toThrow(
        "resolves outside allowed directory"
      );

      expect(validatePathWithinBase).toHaveBeenCalled();
    });

    it("should save compressed JSON when compress option is true", async () => {
      const chunks = [createTestChunk({ id: "chunk-1" })];
      const metadata = createTestMetadata();
      store.addChunks(chunks, [[0.1, 0.2, 0.3]]);
      store.setMetadata(metadata);

      vi.mocked(mkdir).mockResolvedValue(undefined);
      vi.mocked(writeFile).mockResolvedValue(undefined);

      await store.save("/allowed/base/store.json", true);

      // Compressed JSON should not have newlines/indentation
      const writeCall = vi.mocked(writeFile).mock.calls[0];
      const content = writeCall?.[1] as string;
      expect(content).not.toContain("\n  ");
    });
  });

  describe("load", () => {
    it("should load store from valid JSON file", async () => {
      const serializedData = JSON.stringify({
        metadata: createTestMetadata(),
        chunks: [
          {
            chunk: createTestChunk({ id: "loaded-chunk" }),
            embedding: [0.1, 0.2, 0.3],
          },
        ],
        embeddingDimension: 3,
      });

      vi.mocked(readFile).mockResolvedValue(serializedData);

      await store.load("/allowed/base/store.json");

      expect(store.size()).toBe(1);
      expect(store.getChunkById("loaded-chunk")).toBeDefined();
      expect(store.getMetadata()).toBeDefined();
      expect(store.getEmbeddingDimension()).toBe(3);
    });

    it("should throw error on invalid JSON format", async () => {
      vi.mocked(readFile).mockResolvedValue("not valid json");

      await expect(store.load("/allowed/base/store.json")).rejects.toThrow();
    });

    it("should throw error on invalid store structure", async () => {
      const invalidData = JSON.stringify({
        // Missing required fields
        someField: "value",
      });

      vi.mocked(readFile).mockResolvedValue(invalidData);

      await expect(store.load("/allowed/base/store.json")).rejects.toThrow(
        "Invalid store format"
      );
    });

    it("should throw error when metadata structure is invalid", async () => {
      const invalidMetadataData = JSON.stringify({
        metadata: {
          // Missing required fields like projectPath, totalChunks, etc.
          invalidField: "value",
        },
        chunks: [],
        embeddingDimension: 3,
      });

      vi.mocked(readFile).mockResolvedValue(invalidMetadataData);

      await expect(store.load("/allowed/base/store.json")).rejects.toThrow(
        "Invalid store format"
      );
    });
  });

  describe("exists (static)", () => {
    it("should return true when file exists", async () => {
      vi.mocked(access).mockResolvedValue(undefined);

      const result = await CodeVectorStore.exists("/path/to/store.json");

      expect(result).toBe(true);
      expect(access).toHaveBeenCalledWith("/path/to/store.json");
    });

    it("should return false when file does not exist", async () => {
      vi.mocked(access).mockRejectedValue(new Error("ENOENT"));

      const result = await CodeVectorStore.exists("/path/to/nonexistent.json");

      expect(result).toBe(false);
    });
  });

  describe("normalizeVector and dotProduct (via search)", () => {
    it("should correctly normalize vectors and compute cosine similarity", () => {
      // Create chunks with known vectors for predictable similarity
      const chunks = [
        createTestChunk({ id: "identical" }),
        createTestChunk({ id: "orthogonal" }),
      ];

      // [1, 0, 0] and [0, 1, 0] - orthogonal vectors
      const embeddings = [
        [1.0, 0.0, 0.0],
        [0.0, 1.0, 0.0],
      ];
      store.addChunks(chunks, embeddings);

      // Query with [1, 0, 0] - should have score ~1.0 for identical, ~0.0 for orthogonal
      const results = store.search([1.0, 0.0, 0.0], 2);

      expect(results[0]?.chunk.id).toBe("identical");
      expect(results[0]?.vectorScore).toBeCloseTo(1.0, 5);

      expect(results[1]?.chunk.id).toBe("orthogonal");
      expect(results[1]?.vectorScore).toBeCloseTo(0.0, 5);
    });

    it("should handle non-normalized input vectors correctly", () => {
      // Add chunk with non-normalized vector
      const chunks = [createTestChunk({ id: "chunk-1" })];
      const embeddings = [[2.0, 0.0, 0.0]]; // Not normalized (magnitude = 2)
      store.addChunks(chunks, embeddings);

      // Query with non-normalized vector in same direction
      const results = store.search([10.0, 0.0, 0.0], 1);

      // Should still have similarity ~1.0 after normalization
      expect(results[0]?.vectorScore).toBeCloseTo(1.0, 5);
    });

    it("should handle near-zero vectors gracefully", () => {
      // This tests the warning path for zero/near-zero vectors
      const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const chunks = [createTestChunk({ id: "zero-vec" })];
      // Very small vector that will trigger normalization warning
      const embeddings = [[1e-15, 1e-15, 1e-15]];
      store.addChunks(chunks, embeddings);

      const results = store.search([1.0, 0.0, 0.0], 1);

      // Should return result but with 0 similarity
      expect(results.length).toBe(1);
      expect(results[0]?.vectorScore).toBeCloseTo(0.0, 5);

      consoleSpy.mockRestore();
    });
  });

  describe("Edge cases and integration scenarios", () => {
    it("should maintain correct index after multiple add/remove operations", () => {
      // Add initial chunks
      store.addChunks(
        [
          createTestChunk({ id: "a" }),
          createTestChunk({ id: "b" }),
          createTestChunk({ id: "c" }),
        ],
        [
          [0.1, 0.2, 0.3],
          [0.4, 0.5, 0.6],
          [0.7, 0.8, 0.9],
        ]
      );

      // Remove middle chunk
      store.removeChunks(["b"]);

      // Add more chunks
      store.addChunks([createTestChunk({ id: "d" })], [[1.0, 0.0, 0.0]]);

      // Verify all operations
      expect(store.size()).toBe(3);
      expect(store.getChunkById("a")).toBeDefined();
      expect(store.getChunkById("b")).toBeUndefined();
      expect(store.getChunkById("c")).toBeDefined();
      expect(store.getChunkById("d")).toBeDefined();

      // Search should work correctly
      const results = store.search([1.0, 0.0, 0.0], 10);
      expect(results.length).toBe(3);
    });

    it("should preserve chunk data integrity through save/load cycle", async () => {
      const originalChunk = createTestChunk({
        id: "test-id",
        content: "function complex() { return { a: 1, b: 'test' }; }",
        name: "complex",
        filePath: "/src/complex.ts",
        startLine: 10,
        endLine: 15,
        tokenCount: 25,
      });
      const originalMetadata = createTestMetadata({
        projectPath: "/test/project",
        totalChunks: 1,
        totalTokens: 25,
      });

      store.addChunks([originalChunk], [[0.5, 0.5, 0.5]]);
      store.setMetadata(originalMetadata);

      // Capture what would be saved
      let savedContent = "";
      vi.mocked(mkdir).mockResolvedValue(undefined);
      vi.mocked(writeFile).mockImplementation((_, content) => {
        savedContent = content as string;
        return Promise.resolve();
      });

      await store.save("/allowed/base/store.json");

      // Create new store and load
      const newStore = new CodeVectorStore();
      vi.mocked(readFile).mockResolvedValue(savedContent);

      await newStore.load("/allowed/base/store.json");

      // Verify data integrity
      const loadedChunk = newStore.getChunkById("test-id");
      expect(loadedChunk).toEqual(originalChunk);

      const loadedMetadata = newStore.getMetadata();
      expect(loadedMetadata).toEqual(originalMetadata);
    });
  });
});
