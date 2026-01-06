import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { GeminiProvider } from "../../llm/gemini.js";
import { LLMError, LLMErrorSubType } from "../../errors/index.js";
import { z } from "zod";

// =============================================================================
// Type Definitions for Mocking
// =============================================================================

interface GeminiEmbeddingResponse {
  embedding: {
    values: number[];
  };
}

interface GeminiGenerateResponse {
  candidates: Array<{
    content: {
      parts: Array<{ text: string }>;
    };
    finishReason:
      | "STOP"
      | "MAX_TOKENS"
      | "SAFETY"
      | "RECITATION"
      | "OTHER"
      | "FINISH_REASON_UNSPECIFIED";
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
}

interface MockFetchResponse {
  ok: boolean;
  status: number;
  statusText: string;
  headers: Headers;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
}

type MockFetchFn = (
  input: RequestInfo | URL,
  init?: RequestInit
) => Promise<MockFetchResponse>;

// =============================================================================
// Test Utilities
// =============================================================================

function createMockResponse(
  data: unknown,
  options: {
    ok?: boolean;
    status?: number;
    headers?: Record<string, string>;
  } = {}
): MockFetchResponse {
  const { ok = true, status = 200, headers = {} } = options;
  return {
    ok,
    status,
    statusText: ok ? "OK" : "Error",
    headers: new Headers(headers),
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  };
}

function createEmbeddingResponse(values: number[]): GeminiEmbeddingResponse {
  return {
    embedding: { values },
  };
}

function createCompletionResponse(
  text: string,
  finishReason: GeminiGenerateResponse["candidates"][0]["finishReason"] = "STOP",
  tokenCount = 100
): GeminiGenerateResponse {
  return {
    candidates: [
      {
        content: {
          parts: [{ text }],
        },
        finishReason,
      },
    ],
    usageMetadata: {
      totalTokenCount: tokenCount,
    },
  };
}

// =============================================================================
// Tests
// =============================================================================

describe("GeminiProvider", () => {
  let originalFetch: typeof global.fetch;
  let mockFetch: ReturnType<typeof vi.fn<MockFetchFn>>;

  beforeEach(() => {
    originalFetch = global.fetch;
    mockFetch = vi.fn<MockFetchFn>();
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.stubGlobal("fetch", originalFetch);
    vi.restoreAllMocks();
  });

  // ===========================================================================
  // Constructor Tests
  // ===========================================================================

  describe("constructor", () => {
    it("should throw LLM validation error when API key is empty", () => {
      expect(() => new GeminiProvider({ apiKey: "" })).toThrow(z.ZodError);
    });

    it("should create provider with valid API key", () => {
      const provider = new GeminiProvider({ apiKey: "test-api-key" });
      expect(provider.name).toBe("gemini");
    });

    it("should accept custom models and timeout", () => {
      const provider = new GeminiProvider({
        apiKey: "test-key",
        embeddingModel: "custom-embed",
        chatModel: "custom-chat",
        timeout: 120000,
      });
      expect(provider.name).toBe("gemini");
    });
  });

  // ===========================================================================
  // embed() Tests
  // ===========================================================================

  describe("embed(text)", () => {
    it("should return embedding result on success", async () => {
      const expectedValues = [0.1, 0.2, 0.3, 0.4, 0.5];
      mockFetch.mockResolvedValueOnce(
        createMockResponse(createEmbeddingResponse(expectedValues))
      );

      const provider = new GeminiProvider({ apiKey: "test-api-key" });
      const result = await provider.embed("test text");

      expect(result.values).toEqual(expectedValues);
      expect(result.model).toBe("gemini-embedding-001");
      expect(result.tokenCount).toBeGreaterThan(0);
    });

    it("should throw error on API failure", async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse(
          { error: { message: "Internal Server Error" } },
          { ok: false, status: 500 }
        )
      );

      const provider = new GeminiProvider({ apiKey: "test-api-key" });

      await expect(provider.embed("test text")).rejects.toThrow(
        /Gemini embedding API error: 500/
      );
    });

    it("should use API key in URL query parameter", async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse(createEmbeddingResponse([0.1, 0.2]))
      );

      const provider = new GeminiProvider({ apiKey: "secret-key-123" });
      await provider.embed("test");

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("key=secret-key-123"),
        expect.objectContaining({
          headers: expect.objectContaining({
            "Content-Type": "application/json",
          }),
        })
      );
    });
  });

  // ===========================================================================
  // embedBatch() Tests
  // ===========================================================================

  describe("embedBatch(texts)", () => {
    it("should return empty array for empty input", async () => {
      const provider = new GeminiProvider({ apiKey: "test-api-key" });
      const result = await provider.embedBatch([]);

      expect(result).toEqual([]);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("should process texts in batches of 10", async () => {
      const texts = Array.from({ length: 15 }, (_, i) => `text ${i}`);
      const embeddingValues = [0.1, 0.2, 0.3];

      for (let i = 0; i < 15; i++) {
        mockFetch.mockResolvedValueOnce(
          createMockResponse(createEmbeddingResponse(embeddingValues))
        );
      }

      const provider = new GeminiProvider({ apiKey: "test-api-key" });
      const results = await provider.embedBatch(texts);

      expect(results).toHaveLength(15);
      expect(mockFetch).toHaveBeenCalledTimes(15);
    });

    it("should throw LLMError on rate limit (429)", async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse(
          { error: { message: "Rate limit exceeded" } },
          { ok: false, status: 429, headers: { "retry-after": "60" } }
        )
      );

      const provider = new GeminiProvider({ apiKey: "test-api-key" });

      try {
        await provider.embedBatch(["test text"]);
        expect.fail("Should have thrown LLMError");
      } catch (error) {
        expect(error).toBeInstanceOf(LLMError);
        const llmError = error as LLMError;
        expect(llmError.subType).toBe(LLMErrorSubType.RATE_LIMIT);
        expect(llmError.provider).toBe("gemini");
      }
    });
  });

  // ===========================================================================
  // complete() Tests
  // ===========================================================================

  describe("complete(prompt, config)", () => {
    it("should return completion result on success", async () => {
      const expectedText = "This is the generated response.";
      mockFetch.mockResolvedValueOnce(
        createMockResponse(createCompletionResponse(expectedText, "STOP", 150))
      );

      const provider = new GeminiProvider({ apiKey: "test-api-key" });
      const result = await provider.complete("Generate something");

      expect(result.text).toBe(expectedText);
      expect(result.model).toBe("gemini-2.0-flash");
      expect(result.tokenCount).toBe(150);
      expect(result.finishReason).toBe("stop");
    });

    it("should use custom config parameters", async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse(createCompletionResponse("response"))
      );

      const provider = new GeminiProvider({ apiKey: "test-api-key" });
      await provider.complete("test prompt", {
        model: "gemini-2.5-pro",
        temperature: 0.5,
        maxTokens: 2048,
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/models/gemini-2.5-pro:generateContent"),
        expect.objectContaining({
          body: expect.stringContaining('"temperature":0.5'),
        })
      );
    });

    it("should throw error when candidates array is empty", async () => {
      const emptyResponse: GeminiGenerateResponse = {
        candidates: [],
        usageMetadata: { totalTokenCount: 0 },
      };

      mockFetch.mockResolvedValueOnce(createMockResponse(emptyResponse));

      const provider = new GeminiProvider({ apiKey: "test-api-key" });

      await expect(provider.complete("test")).rejects.toThrow(z.ZodError);
    });

    it("should throw error on API failure", async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse(
          { error: { message: "Service unavailable" } },
          { ok: false, status: 503 }
        )
      );

      const provider = new GeminiProvider({ apiKey: "test-api-key" });

      await expect(provider.complete("test")).rejects.toThrow(
        /Gemini completion API error: 503/
      );
    });
  });

  // ===========================================================================
  // checkAvailability() Tests
  // ===========================================================================

  describe("checkAvailability()", () => {
    it("should return available: true on success", async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({ models: [{ name: "gemini-2.0-flash" }] })
      );

      const provider = new GeminiProvider({ apiKey: "test-api-key" });
      const result = await provider.checkAvailability();

      expect(result.available).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it("should return available: false on API error", async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse(
          { error: { message: "Unauthorized" } },
          { ok: false, status: 401 }
        )
      );

      const provider = new GeminiProvider({ apiKey: "test-api-key" });
      const result = await provider.checkAvailability();

      expect(result.available).toBe(false);
      expect(result.error).toContain("Gemini API error: 401");
    });

    it("should return available: false on network error", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network connection failed"));

      const provider = new GeminiProvider({ apiKey: "test-api-key" });
      const result = await provider.checkAvailability();

      expect(result.available).toBe(false);
      expect(result.error).toContain("Gemini connection failed");
      expect(result.error).toContain("Network connection failed");
    });
  });

  // ===========================================================================
  // Finish Reason Mapping Tests
  // ===========================================================================

  describe("mapGeminiFinishReason", () => {
    it("should map STOP to 'stop'", async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse(createCompletionResponse("text", "STOP"))
      );

      const provider = new GeminiProvider({ apiKey: "test-api-key" });
      const result = await provider.complete("test");

      expect(result.finishReason).toBe("stop");
    });

    it("should map MAX_TOKENS to 'length'", async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse(createCompletionResponse("text", "MAX_TOKENS"))
      );

      const provider = new GeminiProvider({ apiKey: "test-api-key" });
      const result = await provider.complete("test");

      expect(result.finishReason).toBe("length");
    });

    it("should map SAFETY to 'content_filter'", async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse(createCompletionResponse("text", "SAFETY"))
      );

      const provider = new GeminiProvider({ apiKey: "test-api-key" });
      const result = await provider.complete("test");

      expect(result.finishReason).toBe("content_filter");
    });

    it("should map RECITATION to 'content_filter'", async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse(createCompletionResponse("text", "RECITATION"))
      );

      const provider = new GeminiProvider({ apiKey: "test-api-key" });
      const result = await provider.complete("test");

      expect(result.finishReason).toBe("content_filter");
    });

    it("should map OTHER to 'unknown'", async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse(createCompletionResponse("text", "OTHER"))
      );

      const provider = new GeminiProvider({ apiKey: "test-api-key" });
      const result = await provider.complete("test");

      expect(result.finishReason).toBe("unknown");
    });

    it("should map FINISH_REASON_UNSPECIFIED to 'unknown'", async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse(
          createCompletionResponse("text", "FINISH_REASON_UNSPECIFIED")
        )
      );

      const provider = new GeminiProvider({ apiKey: "test-api-key" });
      const result = await provider.complete("test");

      expect(result.finishReason).toBe("unknown");
    });
  });
});
