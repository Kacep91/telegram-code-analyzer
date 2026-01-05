import { describe, it, expect } from "vitest";

describe("rag/index.ts re-exports", () => {
  describe("schemas", () => {
    it("should export ChunkTypeSchema", async () => {
      const { ChunkTypeSchema } = await import("../../rag/index.js");
      expect(ChunkTypeSchema).toBeDefined();
    });

    it("should export RAGConfigSchema", async () => {
      const { RAGConfigSchema } = await import("../../rag/index.js");
      expect(RAGConfigSchema).toBeDefined();
    });
  });

  describe("parser functions", () => {
    it("should export parseTypeScriptFile function", async () => {
      const { parseTypeScriptFile } = await import("../../rag/index.js");
      expect(parseTypeScriptFile).toBeDefined();
      expect(typeof parseTypeScriptFile).toBe("function");
    });

    it("should export findTypeScriptFiles function", async () => {
      const { findTypeScriptFiles } = await import("../../rag/index.js");
      expect(findTypeScriptFiles).toBeDefined();
      expect(typeof findTypeScriptFiles).toBe("function");
    });
  });

  describe("chunker functions", () => {
    it("should export chunkEntities function", async () => {
      const { chunkEntities } = await import("../../rag/index.js");
      expect(chunkEntities).toBeDefined();
      expect(typeof chunkEntities).toBe("function");
    });

    it("should export chunkCodebase function", async () => {
      const { chunkCodebase } = await import("../../rag/index.js");
      expect(chunkCodebase).toBeDefined();
      expect(typeof chunkCodebase).toBe("function");
    });

    it("should export estimateTokens function", async () => {
      const { estimateTokens } = await import("../../rag/index.js");
      expect(estimateTokens).toBeDefined();
      expect(typeof estimateTokens).toBe("function");
    });
  });

  describe("store class", () => {
    it("should export CodeVectorStore class", async () => {
      const { CodeVectorStore } = await import("../../rag/index.js");
      expect(CodeVectorStore).toBeDefined();
      expect(typeof CodeVectorStore).toBe("function");
    });
  });

  describe("retriever functions", () => {
    it("should export rerankWithLLM function", async () => {
      const { rerankWithLLM } = await import("../../rag/index.js");
      expect(rerankWithLLM).toBeDefined();
      expect(typeof rerankWithLLM).toBe("function");
    });

    it("should export resolveParentChunks function", async () => {
      const { resolveParentChunks } = await import("../../rag/index.js");
      expect(resolveParentChunks).toBeDefined();
      expect(typeof resolveParentChunks).toBe("function");
    });
  });

  describe("pipeline class", () => {
    it("should export RAGPipeline class", async () => {
      const { RAGPipeline } = await import("../../rag/index.js");
      expect(RAGPipeline).toBeDefined();
      expect(typeof RAGPipeline).toBe("function");
    });
  });
});
