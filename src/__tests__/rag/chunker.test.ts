import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  estimateTokens,
  chunkEntities,
  chunkCodebase,
} from "../../rag/chunker.js";
import type { ParsedEntity } from "../../rag/parser.js";
import type { ChunkType, RAGConfig } from "../../rag/types.js";

/**
 * Factory function to create mock ParsedEntity objects
 */
function createMockEntity(overrides: Partial<ParsedEntity> = {}): ParsedEntity {
  return {
    name: "testFunction",
    type: "function" as ChunkType,
    code: "function test() { return 42; }",
    startLine: 1,
    endLine: 3,
    filePath: "/test/file.ts",
    ...overrides,
  };
}

/**
 * Generate a multi-line code string of specified approximate token count
 */
function generateMultilineCode(
  targetTokens: number,
  linesCount: number
): string {
  const charsPerLine = Math.floor((targetTokens * 4) / linesCount);
  const lines: string[] = [];
  for (let i = 0; i < linesCount; i++) {
    lines.push("x".repeat(charsPerLine));
  }
  return lines.join("\n");
}

describe("RAG Chunker", () => {
  describe("estimateTokens(text)", () => {
    it("should return 0 for empty text", () => {
      const result = estimateTokens("");
      expect(result).toBe(0);
    });

    it("should estimate tokens for short text (~4 chars per token)", () => {
      // 20 characters / 4 = 5 tokens
      const text = "Hello World Testing!";
      const result = estimateTokens(text);
      expect(result).toBe(5);
    });

    it("should estimate tokens for longer text correctly", () => {
      // 400 characters / 4 = 100 tokens
      const text = "a".repeat(400);
      const result = estimateTokens(text);
      expect(result).toBe(100);
    });

    it("should round up partial tokens", () => {
      // 5 characters / 4 = 1.25, ceil = 2
      const text = "hello";
      const result = estimateTokens(text);
      expect(result).toBe(2);
    });
  });

  describe("chunkEntities(entities, config)", () => {
    it("should create one chunk per entity when entities are smaller than chunkSize", () => {
      const smallCode = "const x = 1;"; // 12 chars = ~3 tokens
      const entities: readonly ParsedEntity[] = [
        createMockEntity({ name: "entity1", code: smallCode }),
        createMockEntity({ name: "entity2", code: smallCode }),
      ];

      const config: Partial<RAGConfig> = { chunkSize: 300 };
      const chunks = chunkEntities(entities, config);

      expect(chunks).toHaveLength(2);
      expect(chunks[0]?.name).toBe("entity1");
      expect(chunks[1]?.name).toBe("entity2");
      expect(chunks[0]?.parentId).toBeUndefined();
      expect(chunks[1]?.parentId).toBeUndefined();
    });

    it("should split large entities into multiple chunks", () => {
      // Create a large multi-line entity (>100 tokens, with chunkSize=50)
      const largeCode = generateMultilineCode(200, 20); // ~200 tokens in 20 lines
      const entity = createMockEntity({
        name: "largeFunction",
        code: largeCode,
      });

      const config: Partial<RAGConfig> = { chunkSize: 50, chunkOverlap: 10 };
      const chunks = chunkEntities([entity], config);

      // Should be split into multiple chunks
      expect(chunks.length).toBeGreaterThan(1);

      // Each chunk (except possibly the last) should have parentId
      const chunksWithParent = chunks.filter((c) => c.parentId !== undefined);
      expect(chunksWithParent.length).toBeGreaterThan(0);

      // All chunks should reference the parent entity name
      for (const chunk of chunksWithParent) {
        expect(chunk.parentId).toBe("largeFunction");
      }
    });

    it("should preserve parent entity relationship in split chunks", () => {
      const largeCode = generateMultilineCode(300, 30);
      const entity = createMockEntity({
        name: "parentEntity",
        code: largeCode,
      });

      const config: Partial<RAGConfig> = { chunkSize: 50, chunkOverlap: 10 };
      const chunks = chunkEntities([entity], config);

      // Check that split chunks have indexed names and parentId
      const indexedChunks = chunks.filter((c) => c.name.includes("["));
      expect(indexedChunks.length).toBeGreaterThan(0);

      for (const chunk of indexedChunks) {
        expect(chunk.name).toMatch(/parentEntity\[\d+\]/);
        expect(chunk.parentId).toBe("parentEntity");
      }
    });

    it("should use default config when not provided", () => {
      const smallEntity = createMockEntity({ code: "const a = 1;" });
      const chunks = chunkEntities([smallEntity]);

      expect(chunks).toHaveLength(1);
      expect(chunks[0]?.tokenCount).toBe(estimateTokens("const a = 1;"));
    });

    it("should handle single very long line without splitting", () => {
      // Single line that exceeds chunk size - should not split (edge case)
      const longLine = "x".repeat(2000); // ~500 tokens in one line
      const entity = createMockEntity({
        name: "longLineEntity",
        code: longLine,
      });

      const config: Partial<RAGConfig> = { chunkSize: 50 };
      const chunks = chunkEntities([entity], config);

      // Single line entities should result in one chunk (no splitting possible)
      expect(chunks).toHaveLength(1);
      expect(chunks[0]?.content).toBe(longLine);
      expect(chunks[0]?.parentId).toBeUndefined();
    });
  });

  describe("chunkCodebase(files, config)", () => {
    let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    });

    afterEach(() => {
      consoleWarnSpy.mockRestore();
      vi.resetModules();
    });

    it("should return empty array for empty files list", async () => {
      const chunks = await chunkCodebase([]);
      expect(chunks).toHaveLength(0);
    });

    it("should process multiple files and aggregate chunks", async () => {
      // Mock the parser module
      vi.doMock("../../rag/parser.js", () => ({
        parseTypeScriptFile: vi.fn().mockImplementation((filePath: string) => {
          if (filePath === "/test/file1.ts") {
            return Promise.resolve([
              createMockEntity({ name: "func1", filePath: "/test/file1.ts" }),
            ]);
          }
          if (filePath === "/test/file2.ts") {
            return Promise.resolve([
              createMockEntity({ name: "func2", filePath: "/test/file2.ts" }),
              createMockEntity({ name: "func3", filePath: "/test/file2.ts" }),
            ]);
          }
          return Promise.resolve([]);
        }),
      }));

      // Re-import chunker to use mocked parser
      const { chunkCodebase: mockedChunkCodebase } = await import(
        "../../rag/chunker.js"
      );

      const files = ["/test/file1.ts", "/test/file2.ts"];
      const chunks = await mockedChunkCodebase(files);

      expect(chunks).toHaveLength(3);
      expect(chunks.map((c) => c.name)).toContain("func1");
      expect(chunks.map((c) => c.name)).toContain("func2");
      expect(chunks.map((c) => c.name)).toContain("func3");
    });

    it("should warn and continue when file parsing fails", async () => {
      vi.doMock("../../rag/parser.js", () => ({
        parseTypeScriptFile: vi.fn().mockImplementation((filePath: string) => {
          if (filePath === "/test/bad-file.ts") {
            return Promise.reject(new Error("Syntax error in file"));
          }
          if (filePath === "/test/good-file.ts") {
            return Promise.resolve([
              createMockEntity({
                name: "goodFunc",
                filePath: "/test/good-file.ts",
              }),
            ]);
          }
          return Promise.resolve([]);
        }),
      }));

      const { chunkCodebase: mockedChunkCodebase } = await import(
        "../../rag/chunker.js"
      );

      const files = ["/test/bad-file.ts", "/test/good-file.ts"];
      const chunks = await mockedChunkCodebase(files);

      // Should have processed good-file.ts
      expect(chunks).toHaveLength(1);
      expect(chunks[0]?.name).toBe("goodFunc");

      // Should have warned about bad-file.ts
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining("/test/bad-file.ts")
      );
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining("Syntax error in file")
      );
    });

    it("should pass config to chunkEntities", async () => {
      // Create large entity that would be split with small chunkSize
      const largeCode = generateMultilineCode(200, 20);

      vi.doMock("../../rag/parser.js", () => ({
        parseTypeScriptFile: vi
          .fn()
          .mockResolvedValue([
            createMockEntity({ name: "largeFunc", code: largeCode }),
          ]),
      }));

      const { chunkCodebase: mockedChunkCodebase } = await import(
        "../../rag/chunker.js"
      );

      const config: Partial<RAGConfig> = { chunkSize: 50, chunkOverlap: 10 };
      const chunks = await mockedChunkCodebase(["/test/large.ts"], config);

      // With small chunkSize, large entity should be split
      expect(chunks.length).toBeGreaterThan(1);
    });
  });

  describe("splitLargeEntity (via chunkEntities)", () => {
    it("should split multiline code by lines preserving structure", () => {
      // Create code with distinct lines
      const lines = [
        "function test() {",
        "  const a = 1;",
        "  const b = 2;",
        "  const c = 3;",
        "  const d = 4;",
        "  const e = 5;",
        "  return a + b + c + d + e;",
        "}",
      ];
      const code = lines.join("\n");

      const entity = createMockEntity({
        name: "multilineFunc",
        code,
      });

      // Small chunk size to force splitting
      const config: Partial<RAGConfig> = { chunkSize: 10, chunkOverlap: 2 };
      const chunks = chunkEntities([entity], config);

      // Should be split into multiple chunks
      expect(chunks.length).toBeGreaterThan(1);

      // Each chunk should contain valid code lines
      for (const chunk of chunks) {
        expect(chunk.content.length).toBeGreaterThan(0);
        // Content should be subset of original lines
        const chunkLines = chunk.content.split("\n");
        for (const line of chunkLines) {
          expect(lines).toContain(line);
        }
      }
    });

    it("should apply overlap between consecutive chunks", () => {
      // Create code with many lines to ensure splitting
      const lines: string[] = [];
      for (let i = 0; i < 20; i++) {
        lines.push(`const line${i} = ${i};`);
      }
      const code = lines.join("\n");

      const entity = createMockEntity({
        name: "overlappingFunc",
        code,
      });

      const config: Partial<RAGConfig> = { chunkSize: 30, chunkOverlap: 10 };
      const chunks = chunkEntities([entity], config);

      expect(chunks.length).toBeGreaterThan(1);

      // Check for overlap between consecutive chunks
      for (let i = 0; i < chunks.length - 1; i++) {
        const currentChunk = chunks[i];
        const nextChunk = chunks[i + 1];

        if (currentChunk && nextChunk) {
          const currentLines = currentChunk.content.split("\n");
          const nextLines = nextChunk.content.split("\n");

          // Last lines of current chunk should appear in next chunk (overlap)
          const lastLinesOfCurrent = currentLines.slice(-3);
          const firstLinesOfNext = nextLines.slice(0, 5);

          // At least some overlap should exist
          const hasOverlap = lastLinesOfCurrent.some((line) =>
            firstLinesOfNext.includes(line)
          );
          expect(hasOverlap).toBe(true);
        }
      }
    });
  });
});
