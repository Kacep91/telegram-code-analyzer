import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { JinaEmbeddingProvider } from "../../llm/jina.js";
import { LLMError, LLMErrorSubType } from "../../errors/index.js";

// =============================================================================
// Test Types
// =============================================================================

interface JinaEmbeddingData {
  readonly embedding: number[];
  readonly index: number;
}

interface JinaEmbeddingResponse {
  readonly data: JinaEmbeddingData[];
  readonly usage?: { readonly total_tokens: number };
}

interface MockFetchResponse {
  readonly ok: boolean;
  readonly status: number;
  readonly text: () => Promise<string>;
  readonly json: () => Promise<unknown>;
}

// =============================================================================
// Mock Helpers
// =============================================================================

function createMockResponse(
  body: unknown,
  options: {
    ok?: boolean;
    status?: number;
  } = {}
): MockFetchResponse {
  const { ok = true, status = 200 } = options;
  return {
    ok,
    status,
    text: () => Promise.resolve(typeof body === "string" ? body : JSON.stringify(body)),
    json: () => Promise.resolve(body),
  };
}

function createEmbeddingResponse(
  embeddings: number[][],
  totalTokens = 100
): JinaEmbeddingResponse {
  return {
    data: embeddings.map((embedding, index) => ({ embedding, index })),
    usage: { total_tokens: totalTokens },
  };
}

// =============================================================================
// Tests
// =============================================================================

describe("JinaEmbeddingProvider", () => {
  const TEST_API_KEY = "jina-test-key-123";
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  // ---------------------------------------------------------------------------
  // Constructor Tests
  // ---------------------------------------------------------------------------

  describe("constructor", () => {
    it("should create provider with valid API key", () => {
      const provider = new JinaEmbeddingProvider({ apiKey: TEST_API_KEY });
      expect(provider.name).toBe("jina");
    });

    it("should throw error when API key is empty", () => {
      expect(() => new JinaEmbeddingProvider({ apiKey: "" })).toThrow();
    });

    it("should use default model jina-embeddings-v3", () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse(createEmbeddingResponse([[0.1, 0.2, 0.3]]))
      );

      const provider = new JinaEmbeddingProvider({ apiKey: TEST_API_KEY });

      // Trigger a request to verify default model
      void provider.embed("test");

      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.jina.ai/v1/embeddings",
        expect.objectContaining({
          body: expect.stringContaining('"model":"jina-embeddings-v3"'),
        })
      );
    });

    it("should allow custom model", () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse(createEmbeddingResponse([[0.1, 0.2, 0.3]]))
      );

      const provider = new JinaEmbeddingProvider({
        apiKey: TEST_API_KEY,
        model: "jina-embeddings-v2-base-en",
      });

      void provider.embed("test");

      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.jina.ai/v1/embeddings",
        expect.objectContaining({
          body: expect.stringContaining('"model":"jina-embeddings-v2-base-en"'),
        })
      );
    });

    it("should allow custom timeout", () => {
      const provider = new JinaEmbeddingProvider({
        apiKey: TEST_API_KEY,
        timeout: 30000,
      });
      expect(provider.name).toBe("jina");
    });

    it("should throw error when timeout is too small", () => {
      expect(
        () =>
          new JinaEmbeddingProvider({
            apiKey: TEST_API_KEY,
            timeout: 500, // Less than 1000ms minimum
          })
      ).toThrow();
    });

    it("should throw error when timeout is too large", () => {
      expect(
        () =>
          new JinaEmbeddingProvider({
            apiKey: TEST_API_KEY,
            timeout: 400000, // More than 300000ms maximum
          })
      ).toThrow();
    });
  });

  // ---------------------------------------------------------------------------
  // embed() Tests
  // ---------------------------------------------------------------------------

  describe("embed(text)", () => {
    it("should return embedding result for single text", async () => {
      const expectedEmbedding = [0.1, 0.2, 0.3, 0.4, 0.5];
      mockFetch.mockResolvedValueOnce(
        createMockResponse(createEmbeddingResponse([expectedEmbedding]))
      );

      const provider = new JinaEmbeddingProvider({ apiKey: TEST_API_KEY });
      const result = await provider.embed("test text");

      expect(result.values).toEqual(expectedEmbedding);
      expect(result.model).toBe("jina-embeddings-v3");
      expect(result.tokenCount).toBeGreaterThan(0);
    });

    it("should send correct headers with Authorization", async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse(createEmbeddingResponse([[0.1, 0.2, 0.3]]))
      );

      const provider = new JinaEmbeddingProvider({ apiKey: TEST_API_KEY });
      await provider.embed("test");

      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.jina.ai/v1/embeddings",
        expect.objectContaining({
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${TEST_API_KEY}`,
          },
        })
      );
    });

    it("should throw LLMError with INVALID_RESPONSE when result is empty", async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({ data: [], usage: { total_tokens: 0 } })
      );

      const provider = new JinaEmbeddingProvider({ apiKey: TEST_API_KEY });

      try {
        await provider.embed("test text");
        expect.fail("Should have thrown LLMError");
      } catch (error) {
        expect(error).toBeInstanceOf(LLMError);
        const llmError = error as LLMError;
        expect(llmError.subType).toBe(LLMErrorSubType.INVALID_RESPONSE);
        expect(llmError.provider).toBe("jina");
        expect(llmError.message).toContain("Empty embedding result");
      }
    });

    it("should throw LLMError with AUTH_FAILED on 401 response", async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse("Invalid API key", { ok: false, status: 401 })
      );

      const provider = new JinaEmbeddingProvider({ apiKey: TEST_API_KEY });

      try {
        await provider.embed("test");
        expect.fail("Should have thrown LLMError");
      } catch (error) {
        expect(error).toBeInstanceOf(LLMError);
        const llmError = error as LLMError;
        expect(llmError.subType).toBe(LLMErrorSubType.AUTH_FAILED);
        expect(llmError.provider).toBe("jina");
        expect(llmError.message).toContain("401");
      }
    });

    it("should throw LLMError with RATE_LIMITED on 429 response", async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse("Rate limit exceeded", { ok: false, status: 429 })
      );

      const provider = new JinaEmbeddingProvider({ apiKey: TEST_API_KEY });

      try {
        await provider.embed("test");
        expect.fail("Should have thrown LLMError");
      } catch (error) {
        expect(error).toBeInstanceOf(LLMError);
        const llmError = error as LLMError;
        expect(llmError.subType).toBe(LLMErrorSubType.RATE_LIMIT);
        expect(llmError.provider).toBe("jina");
      }
    });

    it("should throw LLMError with API_ERROR on other HTTP errors", async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse("Internal server error", { ok: false, status: 500 })
      );

      const provider = new JinaEmbeddingProvider({ apiKey: TEST_API_KEY });

      try {
        await provider.embed("test");
        expect.fail("Should have thrown LLMError");
      } catch (error) {
        expect(error).toBeInstanceOf(LLMError);
        const llmError = error as LLMError;
        expect(llmError.subType).toBe(LLMErrorSubType.API_ERROR);
        expect(llmError.provider).toBe("jina");
        expect(llmError.message).toContain("500");
      }
    });

    it("should throw LLMError with TIMEOUT on AbortError", async () => {
      const abortError = new Error("Aborted");
      abortError.name = "AbortError";
      // Mock all 3 retry attempts
      mockFetch.mockRejectedValue(abortError);

      const provider = new JinaEmbeddingProvider({
        apiKey: TEST_API_KEY,
        timeout: 1000,
      });

      // Run promise and timers concurrently to avoid unhandled rejection
      await expect(
        Promise.all([
          provider.embed("test"),
          vi.runAllTimersAsync(),
        ]).then(([result]) => result)
      ).rejects.toMatchObject({
        subType: LLMErrorSubType.TIMEOUT,
        provider: "jina",
      });
    });

    it("should throw LLMError with API_ERROR on network error", async () => {
      // Mock all 3 retry attempts
      mockFetch.mockRejectedValue(new Error("Network error"));

      const provider = new JinaEmbeddingProvider({ apiKey: TEST_API_KEY });

      // Run promise and timers concurrently to avoid unhandled rejection
      await expect(
        Promise.all([
          provider.embed("test"),
          vi.runAllTimersAsync(),
        ]).then(([result]) => result)
      ).rejects.toMatchObject({
        subType: LLMErrorSubType.API_ERROR,
        provider: "jina",
      });
    });

    it("should handle non-Error thrown objects", async () => {
      // Mock all 3 retry attempts
      mockFetch.mockRejectedValue("string error");

      const provider = new JinaEmbeddingProvider({ apiKey: TEST_API_KEY });

      // Run promise and timers concurrently to avoid unhandled rejection
      await expect(
        Promise.all([
          provider.embed("test"),
          vi.runAllTimersAsync(),
        ]).then(([result]) => result)
      ).rejects.toMatchObject({
        subType: LLMErrorSubType.API_ERROR,
        provider: "jina",
      });
    });
  });

  // ---------------------------------------------------------------------------
  // embedBatch() Tests
  // ---------------------------------------------------------------------------

  describe("embedBatch(texts)", () => {
    it("should return empty array for empty input", async () => {
      const provider = new JinaEmbeddingProvider({ apiKey: TEST_API_KEY });
      const results = await provider.embedBatch([]);

      expect(results).toEqual([]);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("should embed multiple texts", async () => {
      const expectedEmbeddings = [
        [0.1, 0.2, 0.3],
        [0.4, 0.5, 0.6],
        [0.7, 0.8, 0.9],
      ];
      mockFetch.mockResolvedValueOnce(
        createMockResponse(createEmbeddingResponse(expectedEmbeddings))
      );

      const provider = new JinaEmbeddingProvider({ apiKey: TEST_API_KEY });
      const results = await provider.embedBatch(["text1", "text2", "text3"]);

      expect(results).toHaveLength(3);
      expect(results[0]?.values).toEqual(expectedEmbeddings[0]);
      expect(results[1]?.values).toEqual(expectedEmbeddings[1]);
      expect(results[2]?.values).toEqual(expectedEmbeddings[2]);
    });

    it("should sort results by index", async () => {
      // API returns data out of order
      const responseWithUnorderedData = {
        data: [
          { embedding: [0.7, 0.8, 0.9], index: 2 },
          { embedding: [0.1, 0.2, 0.3], index: 0 },
          { embedding: [0.4, 0.5, 0.6], index: 1 },
        ],
        usage: { total_tokens: 30 },
      };
      mockFetch.mockResolvedValueOnce(
        createMockResponse(responseWithUnorderedData)
      );

      const provider = new JinaEmbeddingProvider({ apiKey: TEST_API_KEY });
      const results = await provider.embedBatch(["text1", "text2", "text3"]);

      expect(results[0]?.values).toEqual([0.1, 0.2, 0.3]);
      expect(results[1]?.values).toEqual([0.4, 0.5, 0.6]);
      expect(results[2]?.values).toEqual([0.7, 0.8, 0.9]);
    });

    it("should estimate token count based on text length", async () => {
      const embedding = [0.1, 0.2, 0.3];
      mockFetch.mockResolvedValueOnce(
        createMockResponse(createEmbeddingResponse([embedding]))
      );

      const provider = new JinaEmbeddingProvider({ apiKey: TEST_API_KEY });
      const testText = "This is a test text with some length";
      const results = await provider.embedBatch([testText]);

      // Token count should be approximately text.length / 4
      const expectedTokenCount = Math.ceil(testText.length / 4);
      expect(results[0]?.tokenCount).toBe(expectedTokenCount);
    });

    it("should throw LLMError on batch API error", async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse("Bad request", { ok: false, status: 400 })
      );

      const provider = new JinaEmbeddingProvider({ apiKey: TEST_API_KEY });

      try {
        await provider.embedBatch(["text1", "text2"]);
        expect.fail("Should have thrown LLMError");
      } catch (error) {
        expect(error).toBeInstanceOf(LLMError);
        const llmError = error as LLMError;
        expect(llmError.subType).toBe(LLMErrorSubType.API_ERROR);
        expect(llmError.provider).toBe("jina");
      }
    });

    it("should handle response without usage field", async () => {
      const responseWithoutUsage = {
        data: [{ embedding: [0.1, 0.2, 0.3], index: 0 }],
      };
      mockFetch.mockResolvedValueOnce(
        createMockResponse(responseWithoutUsage)
      );

      const provider = new JinaEmbeddingProvider({ apiKey: TEST_API_KEY });
      const results = await provider.embedBatch(["test"]);

      expect(results).toHaveLength(1);
      expect(results[0]?.values).toEqual([0.1, 0.2, 0.3]);
    });

    it("should handle Zod validation error for invalid response", async () => {
      const invalidResponse = {
        data: [{ invalid_field: "test" }],
      };
      mockFetch.mockResolvedValueOnce(createMockResponse(invalidResponse));

      const provider = new JinaEmbeddingProvider({ apiKey: TEST_API_KEY });

      await expect(provider.embedBatch(["test"])).rejects.toThrow();
    });
  });

  // ---------------------------------------------------------------------------
  // checkAvailability() Tests
  // ---------------------------------------------------------------------------

  describe("checkAvailability()", () => {
    it("should return available: true when API is available", async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse(createEmbeddingResponse([[0.1, 0.2, 0.3]]))
      );

      const provider = new JinaEmbeddingProvider({ apiKey: TEST_API_KEY });
      const result = await provider.checkAvailability();

      expect(result.available).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it("should return available: false when API returns error", async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse("Invalid API key", { ok: false, status: 401 })
      );

      const provider = new JinaEmbeddingProvider({ apiKey: TEST_API_KEY });
      const result = await provider.checkAvailability();

      expect(result.available).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error).toContain("401");
    });

    it("should return available: false on network error", async () => {
      // Mock all 3 retry attempts
      mockFetch.mockRejectedValue(new Error("Connection refused"));

      const provider = new JinaEmbeddingProvider({ apiKey: TEST_API_KEY });

      // Run promise and timers concurrently
      const [result] = await Promise.all([
        provider.checkAvailability(),
        vi.runAllTimersAsync(),
      ]);

      expect(result.available).toBe(false);
      expect(result.error).toContain("Connection refused");
    });

    it("should return available: false when embedding result is empty", async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({ data: [], usage: { total_tokens: 0 } })
      );

      const provider = new JinaEmbeddingProvider({ apiKey: TEST_API_KEY });
      const result = await provider.checkAvailability();

      expect(result.available).toBe(false);
      expect(result.error).toContain("Empty embedding result");
    });

    it("should handle non-Error thrown objects in checkAvailability", async () => {
      // Mock all 3 retry attempts
      mockFetch.mockRejectedValue("string error");

      const provider = new JinaEmbeddingProvider({ apiKey: TEST_API_KEY });

      // Run promise and timers concurrently
      const [result] = await Promise.all([
        provider.checkAvailability(),
        vi.runAllTimersAsync(),
      ]);

      expect(result.available).toBe(false);
      // Non-Error objects are converted to string via String()
      expect(result.error).toContain("string error");
    });
  });

  // ---------------------------------------------------------------------------
  // Integration-like Tests
  // ---------------------------------------------------------------------------

  describe("request format", () => {
    it("should send correct request body format", async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse(createEmbeddingResponse([[0.1, 0.2, 0.3]]))
      );

      const provider = new JinaEmbeddingProvider({
        apiKey: TEST_API_KEY,
        model: "jina-embeddings-v3",
      });
      await provider.embed("test text");

      const callArgs = mockFetch.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(callArgs[1].body as string) as {
        model: string;
        input: string[];
      };

      expect(body.model).toBe("jina-embeddings-v3");
      expect(body.input).toEqual(["test text"]);
    });

    it("should truncate long error messages in API error", async () => {
      const longErrorMessage = "x".repeat(500);
      mockFetch.mockResolvedValueOnce(
        createMockResponse(longErrorMessage, { ok: false, status: 400 })
      );

      const provider = new JinaEmbeddingProvider({ apiKey: TEST_API_KEY });

      try {
        await provider.embed("test");
        expect.fail("Should have thrown LLMError");
      } catch (error) {
        expect(error).toBeInstanceOf(LLMError);
        const llmError = error as LLMError;
        // Error message should be truncated to first 200 characters
        expect(llmError.message.length).toBeLessThan(300);
      }
    });
  });
});
