import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type {
  LLMEmbeddingProvider,
  LLMCompletionProvider,
  EmbeddingResult,
  CompletionResult,
} from "../../llm/types.js";
import type {
  CodeChunk,
  ChunkMetadata,
  SearchResult,
} from "../../rag/types.js";

// Mock dependencies before importing RAGPipeline
vi.mock("../../rag/store.js", () => {
  return {
    CodeVectorStore: vi.fn().mockImplementation(() => ({
      clear: vi.fn(),
      addChunks: vi.fn(),
      setMetadata: vi.fn(),
      getMetadata: vi.fn(),
      save: vi.fn(),
      load: vi.fn(),
      isEmpty: vi.fn(),
      size: vi.fn(),
      search: vi.fn(),
      getAllChunks: vi.fn(),
    })),
  };
});

vi.mock("../../rag/parser.js", () => ({
  findTypeScriptFiles: vi.fn(),
}));

vi.mock("../../rag/chunker.js", () => ({
  chunkCodebase: vi.fn(),
}));

vi.mock("../../rag/retriever.js", () => ({
  rerankWithLLM: vi.fn(),
  resolveParentChunks: vi.fn(),
}));

// Import after mocking
import { RAGPipeline } from "../../rag/pipeline.js";
import { CodeVectorStore } from "../../rag/store.js";
import { findTypeScriptFiles } from "../../rag/parser.js";
import { chunkCodebase } from "../../rag/chunker.js";
import { rerankWithLLM, resolveParentChunks } from "../../rag/retriever.js";

// Helper functions to create mock data
function createMockChunk(overrides: Partial<CodeChunk> = {}): CodeChunk {
  return {
    id: "chunk-1",
    content: "function test() { return 1; }",
    type: "function",
    name: "test",
    filePath: "/project/src/test.ts",
    startLine: 1,
    endLine: 5,
    tokenCount: 10,
    ...overrides,
  };
}

function createMockSearchResult(
  overrides: Partial<SearchResult> = {}
): SearchResult {
  return {
    chunk: createMockChunk(),
    vectorScore: 0.9,
    finalScore: 0.85,
    ...overrides,
  };
}

function createMockMetadata(
  overrides: Partial<ChunkMetadata> = {}
): ChunkMetadata {
  return {
    projectPath: "/project",
    totalChunks: 10,
    totalTokens: 500,
    indexedAt: new Date().toISOString(),
    version: "1.0.0",
    ...overrides,
  };
}

function createMockEmbeddingResult(
  overrides: Partial<EmbeddingResult> = {}
): EmbeddingResult {
  return {
    values: [0.1, 0.2, 0.3, 0.4, 0.5],
    tokenCount: 10,
    model: "text-embedding-3-small",
    ...overrides,
  };
}

function createMockCompletionResult(
  overrides: Partial<CompletionResult> = {}
): CompletionResult {
  return {
    text: "This is the generated answer based on the code snippets.",
    tokenCount: 50,
    model: "gpt-4",
    finishReason: "stop",
    ...overrides,
  };
}

// Mock providers
function createMockEmbeddingProvider(): LLMEmbeddingProvider {
  return {
    embed: vi.fn().mockResolvedValue(createMockEmbeddingResult()),
    embedBatch: vi
      .fn()
      .mockResolvedValue([
        createMockEmbeddingResult(),
        createMockEmbeddingResult({ values: [0.2, 0.3, 0.4, 0.5, 0.6] }),
      ]),
  };
}

function createMockCompletionProvider(): LLMCompletionProvider {
  return {
    name: "openai",
    complete: vi.fn().mockResolvedValue(createMockCompletionResult()),
    checkAvailability: vi.fn().mockResolvedValue({ available: true }),
  };
}

describe("RAGPipeline", () => {
  let mockStore: ReturnType<
    typeof vi.mocked<InstanceType<typeof CodeVectorStore>>
  >;
  let mockEmbeddingProvider: LLMEmbeddingProvider;
  let mockCompletionProvider: LLMCompletionProvider;

  beforeEach(() => {
    vi.clearAllMocks();

    // Reset store mock for each test
    const MockedCodeVectorStore = vi.mocked(CodeVectorStore);
    MockedCodeVectorStore.mockClear();

    mockStore = {
      clear: vi.fn(),
      addChunks: vi.fn(),
      setMetadata: vi.fn(),
      getMetadata: vi.fn().mockReturnValue(null),
      save: vi.fn().mockResolvedValue(undefined),
      load: vi.fn().mockResolvedValue(undefined),
      isEmpty: vi.fn().mockReturnValue(true),
      size: vi.fn().mockReturnValue(0),
      search: vi.fn().mockReturnValue([]),
      getAllChunks: vi.fn().mockReturnValue([]),
    } as unknown as ReturnType<
      typeof vi.mocked<InstanceType<typeof CodeVectorStore>>
    >;

    MockedCodeVectorStore.mockImplementation(
      () => mockStore as unknown as CodeVectorStore
    );

    // Setup static method mock
    vi.mocked(CodeVectorStore).exists = vi.fn().mockResolvedValue(false);

    mockEmbeddingProvider = createMockEmbeddingProvider();
    mockCompletionProvider = createMockCompletionProvider();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("constructor", () => {
    it("should create pipeline with default config", () => {
      const pipeline = new RAGPipeline();

      expect(pipeline).toBeDefined();
      expect(CodeVectorStore).toHaveBeenCalledOnce();
    });

    it("should create pipeline with custom config", () => {
      const customConfig = {
        chunkSize: 500,
        chunkOverlap: 100,
        topK: 20,
        rerankTopK: 10,
        vectorWeight: 0.4,
        llmWeight: 0.6,
      };

      const pipeline = new RAGPipeline(customConfig);

      expect(pipeline).toBeDefined();
      expect(CodeVectorStore).toHaveBeenCalledOnce();
    });
  });

  describe("index", () => {
    it("should successfully index project and populate store", async () => {
      const mockFiles = ["/project/src/a.ts", "/project/src/b.ts"];
      const mockChunks = [
        createMockChunk({ id: "chunk-1", tokenCount: 100 }),
        createMockChunk({ id: "chunk-2", tokenCount: 150 }),
      ];

      vi.mocked(findTypeScriptFiles).mockResolvedValue(mockFiles);
      vi.mocked(chunkCodebase).mockResolvedValue(mockChunks);

      const pipeline = new RAGPipeline();
      const metadata = await pipeline.index(
        "/project",
        mockEmbeddingProvider,
        "/store"
      );

      expect(findTypeScriptFiles).toHaveBeenCalledWith("/project");
      expect(chunkCodebase).toHaveBeenCalledWith(mockFiles, expect.any(Object));
      expect(mockEmbeddingProvider.embedBatch).toHaveBeenCalled();
      expect(mockStore.clear).toHaveBeenCalled();
      expect(mockStore.addChunks).toHaveBeenCalledWith(
        mockChunks,
        expect.any(Array)
      );
      expect(mockStore.setMetadata).toHaveBeenCalled();
      expect(mockStore.save).toHaveBeenCalled();

      expect(metadata.projectPath).toBe("/project");
      expect(metadata.totalChunks).toBe(2);
      expect(metadata.totalTokens).toBe(250);
      expect(metadata.version).toBe("1.0.0");
    });

    it("should throw error when no TypeScript files found", async () => {
      vi.mocked(findTypeScriptFiles).mockResolvedValue([]);

      const pipeline = new RAGPipeline();

      await expect(
        pipeline.index("/project", mockEmbeddingProvider)
      ).rejects.toThrow("No TypeScript files found in /project");
    });

    it("should throw error when no chunks generated", async () => {
      vi.mocked(findTypeScriptFiles).mockResolvedValue(["/project/src/a.ts"]);
      vi.mocked(chunkCodebase).mockResolvedValue([]);

      const pipeline = new RAGPipeline();

      await expect(
        pipeline.index("/project", mockEmbeddingProvider)
      ).rejects.toThrow("No chunks generated from files");
    });
  });

  describe("loadIndex", () => {
    it("should successfully load index and restore store", async () => {
      const mockMetadata = createMockMetadata();
      const mockChunks = [createMockChunk()];

      vi.mocked(CodeVectorStore).exists = vi.fn().mockResolvedValue(true);
      mockStore.getMetadata = vi.fn().mockReturnValue(mockMetadata);
      mockStore.getAllChunks = vi.fn().mockReturnValue(mockChunks);

      const pipeline = new RAGPipeline();
      const result = await pipeline.loadIndex("/store");

      expect(CodeVectorStore.exists).toHaveBeenCalledWith(
        "/store/rag-index.json"
      );
      expect(mockStore.load).toHaveBeenCalledWith("/store/rag-index.json");
      expect(result).toEqual(mockMetadata);
    });

    it("should return null when file not found", async () => {
      vi.mocked(CodeVectorStore).exists = vi.fn().mockResolvedValue(false);

      const pipeline = new RAGPipeline();
      const result = await pipeline.loadIndex("/store");

      expect(result).toBeNull();
      expect(mockStore.load).not.toHaveBeenCalled();
    });

    it("should clear store and return null on version mismatch", async () => {
      const outdatedMetadata = createMockMetadata({ version: "0.9.0" });

      vi.mocked(CodeVectorStore).exists = vi.fn().mockResolvedValue(true);
      mockStore.getMetadata = vi.fn().mockReturnValue(outdatedMetadata);

      const pipeline = new RAGPipeline();
      const result = await pipeline.loadIndex("/store");

      expect(mockStore.clear).toHaveBeenCalled();
      expect(result).toBeNull();
    });
  });

  describe("query", () => {
    it("should return RAGQueryResult on successful query", async () => {
      const mockSearchResults = [createMockSearchResult()];
      const mockRerankedResults = [
        createMockSearchResult({ finalScore: 0.95, llmScore: 0.9 }),
      ];

      mockStore.isEmpty = vi.fn().mockReturnValue(false);
      mockStore.search = vi.fn().mockReturnValue(mockSearchResults);
      vi.mocked(rerankWithLLM).mockResolvedValue(mockRerankedResults);
      vi.mocked(resolveParentChunks).mockReturnValue(mockRerankedResults);

      const pipeline = new RAGPipeline();
      const result = await pipeline.query(
        "What does the test function do?",
        mockEmbeddingProvider,
        mockCompletionProvider
      );

      expect(mockEmbeddingProvider.embed).toHaveBeenCalledWith(
        "What does the test function do?"
      );
      expect(mockStore.search).toHaveBeenCalled();
      expect(rerankWithLLM).toHaveBeenCalled();
      expect(resolveParentChunks).toHaveBeenCalled();
      expect(mockCompletionProvider.complete).toHaveBeenCalled();

      expect(result.answer).toBe(
        "This is the generated answer based on the code snippets."
      );
      expect(result.sources).toEqual(mockRerankedResults);
      expect(result.tokenCount).toBe(50);
    });

    it("should throw error when index is empty", async () => {
      mockStore.isEmpty = vi.fn().mockReturnValue(true);

      const pipeline = new RAGPipeline();

      await expect(
        pipeline.query(
          "What does the test function do?",
          mockEmbeddingProvider,
          mockCompletionProvider
        )
      ).rejects.toThrow("Index is empty. Run index() or loadIndex() first.");
    });

    it("should return empty results array when no search results", async () => {
      mockStore.isEmpty = vi.fn().mockReturnValue(false);
      mockStore.search = vi.fn().mockReturnValue([]);

      const pipeline = new RAGPipeline();
      const result = await pipeline.query(
        "Nonexistent function",
        mockEmbeddingProvider,
        mockCompletionProvider
      );

      expect(result.answer).toBe("No relevant code found for your query.");
      expect(result.sources).toEqual([]);
      expect(result.tokenCount).toBe(0);
    });
  });

  describe("getStatus", () => {
    it("should return indexed status with metadata when indexed", () => {
      const mockMetadata = createMockMetadata();
      mockStore.isEmpty = vi.fn().mockReturnValue(false);
      mockStore.getMetadata = vi.fn().mockReturnValue(mockMetadata);

      const pipeline = new RAGPipeline();
      const status = pipeline.getStatus();

      expect(status.indexed).toBe(true);
      expect(status.metadata).toEqual(mockMetadata);
    });

    it("should return not indexed status when store is empty", () => {
      mockStore.isEmpty = vi.fn().mockReturnValue(true);
      mockStore.getMetadata = vi.fn().mockReturnValue(null);

      const pipeline = new RAGPipeline();
      const status = pipeline.getStatus();

      expect(status.indexed).toBe(false);
      expect(status.metadata).toBeNull();
    });
  });

  describe("getChunkCount", () => {
    it("should return chunk count from store", () => {
      mockStore.size = vi.fn().mockReturnValue(42);

      const pipeline = new RAGPipeline();
      const count = pipeline.getChunkCount();

      expect(count).toBe(42);
      expect(mockStore.size).toHaveBeenCalled();
    });
  });

  describe("clear", () => {
    it("should clear the store and internal chunks", () => {
      const pipeline = new RAGPipeline();
      pipeline.clear();

      expect(mockStore.clear).toHaveBeenCalled();
    });
  });
});
