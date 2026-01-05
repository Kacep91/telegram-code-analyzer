import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { OpenAIProvider } from "../../llm/openai.js";
import { LLMError, LLMErrorSubType } from "../../errors/index.js";

// =============================================================================
// Mock Types (avoiding 'any')
// =============================================================================

interface MockFetchResponse {
  ok: boolean;
  status: number;
  statusText: string;
  headers: Map<string, string>;
  text: () => Promise<string>;
}

interface OpenAIEmbeddingData {
  embedding: number[];
  index: number;
}

interface OpenAIEmbeddingResponse {
  data: OpenAIEmbeddingData[];
  usage: { total_tokens: number };
  model: string;
}

interface OpenAIChatChoice {
  message: { content: string | null };
  finish_reason: string;
}

interface OpenAIChatResponse {
  choices: OpenAIChatChoice[];
  usage: { total_tokens: number };
  model: string;
}

interface OpenAIErrorResponse {
  error: { message: string; type: string; code: string | null };
}

interface OpenAIModelsResponse {
  data: Array<{ id: string }>;
}

// =============================================================================
// Mock Helpers
// =============================================================================

function createMockResponse(
  body: unknown,
  options: {
    ok?: boolean;
    status?: number;
    statusText?: string;
    headers?: Map<string, string>;
  } = {}
): MockFetchResponse {
  const {
    ok = true,
    status = 200,
    statusText = "OK",
    headers = new Map(),
  } = options;
  return {
    ok,
    status,
    statusText,
    headers,
    text: () => Promise.resolve(JSON.stringify(body)),
  };
}

function createEmbeddingResponse(
  embeddings: number[][],
  model = "text-embedding-3-large"
): OpenAIEmbeddingResponse {
  return {
    data: embeddings.map((embedding, index) => ({ embedding, index })),
    usage: { total_tokens: embeddings.length * 10 },
    model,
  };
}

function createChatResponse(
  content: string | null,
  finishReason = "stop",
  model = "gpt-4.1-mini"
): OpenAIChatResponse {
  return {
    choices: [{ message: { content }, finish_reason: finishReason }],
    usage: { total_tokens: 100 },
    model,
  };
}

function createErrorResponse(
  message: string,
  type: string,
  code: string | null = null
): OpenAIErrorResponse {
  return { error: { message, type, code } };
}

// =============================================================================
// Tests
// =============================================================================

describe("OpenAIProvider", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  // ---------------------------------------------------------------------------
  // Constructor Tests
  // ---------------------------------------------------------------------------

  describe("constructor", () => {
    it("should create provider with valid API key", () => {
      const provider = new OpenAIProvider("sk-test-key");
      expect(provider.name).toBe("openai");
    });

    it("should create provider with custom models and timeout", () => {
      const provider = new OpenAIProvider(
        "sk-test-key",
        "text-embedding-ada-002",
        "gpt-4",
        30000
      );
      expect(provider.name).toBe("openai");
    });
  });

  // ---------------------------------------------------------------------------
  // embed() Tests
  // ---------------------------------------------------------------------------

  describe("embed(text)", () => {
    it("should return embedding result on success", async () => {
      const expectedEmbedding = [0.1, 0.2, 0.3, 0.4, 0.5];
      mockFetch.mockResolvedValueOnce(
        createMockResponse(createEmbeddingResponse([expectedEmbedding]))
      );

      const provider = new OpenAIProvider("sk-test-key");
      const result = await provider.embed("test text");

      expect(result.values).toEqual(expectedEmbedding);
      expect(result.model).toBe("text-embedding-3-large");
      expect(result.tokenCount).toBeGreaterThan(0);
    });

    it("should throw Error when result is empty", async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          data: [],
          usage: { total_tokens: 0 },
          model: "text-embedding-3-large",
        })
      );

      const provider = new OpenAIProvider("sk-test-key");

      await expect(provider.embed("test text")).rejects.toThrow(
        "OpenAI returned empty embedding result"
      );
    });

    it("should throw Error on API error", async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse(
          createErrorResponse("Invalid API key", "invalid_request_error"),
          { ok: false, status: 401, statusText: "Unauthorized" }
        )
      );

      const provider = new OpenAIProvider("sk-test-key");

      await expect(provider.embed("test text")).rejects.toThrow(
        /OpenAI Embedding API error:/
      );
    });
  });

  // ---------------------------------------------------------------------------
  // embedBatch() Tests
  // ---------------------------------------------------------------------------

  describe("embedBatch(texts)", () => {
    it("should return batch embedding results on success", async () => {
      const expectedEmbeddings = [
        [0.1, 0.2, 0.3],
        [0.4, 0.5, 0.6],
        [0.7, 0.8, 0.9],
      ];
      mockFetch.mockResolvedValueOnce(
        createMockResponse(createEmbeddingResponse(expectedEmbeddings))
      );

      const provider = new OpenAIProvider("sk-test-key");
      const results = await provider.embedBatch(["text1", "text2", "text3"]);

      expect(results).toHaveLength(3);
      expect(results[0]?.values).toEqual(expectedEmbeddings[0]);
      expect(results[1]?.values).toEqual(expectedEmbeddings[1]);
      expect(results[2]?.values).toEqual(expectedEmbeddings[2]);
    });

    it("should return empty array for empty input", async () => {
      const provider = new OpenAIProvider("sk-test-key");
      const results = await provider.embedBatch([]);

      expect(results).toEqual([]);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("should throw LLMError on rate limit (429)", async () => {
      const headers = new Map<string, string>();
      headers.set("retry-after", "60");

      mockFetch.mockResolvedValueOnce(
        createMockResponse(
          createErrorResponse("Rate limit exceeded", "rate_limit_error"),
          { ok: false, status: 429, statusText: "Too Many Requests", headers }
        )
      );

      const provider = new OpenAIProvider("sk-test-key");

      await expect(provider.embedBatch(["test"])).rejects.toThrow(LLMError);

      try {
        await provider.embedBatch(["test2"]);
      } catch (error) {
        if (error instanceof LLMError) {
          expect(error.subType).toBe(LLMErrorSubType.RATE_LIMIT);
          expect(error.provider).toBe("openai");
        }
      }
    });
  });

  // ---------------------------------------------------------------------------
  // complete() Tests
  // ---------------------------------------------------------------------------

  describe("complete(prompt, config)", () => {
    it("should return completion result with content", async () => {
      const expectedContent = "This is the AI response";
      mockFetch.mockResolvedValueOnce(
        createMockResponse(createChatResponse(expectedContent))
      );

      const provider = new OpenAIProvider("sk-test-key");
      const result = await provider.complete("Hello, AI!");

      expect(result.text).toBe(expectedContent);
      expect(result.model).toBe("gpt-4.1-mini");
      expect(result.finishReason).toBe("stop");
      expect(result.tokenCount).toBe(100);
    });

    it("should throw Error when choices array is empty", async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          choices: [],
          usage: { total_tokens: 0 },
          model: "gpt-4.1-mini",
        })
      );

      const provider = new OpenAIProvider("sk-test-key");

      await expect(provider.complete("test")).rejects.toThrow(
        "OpenAI returned empty choices array"
      );
    });

    it("should throw Error on API error", async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse(
          createErrorResponse("Model not found", "model_not_found"),
          { ok: false, status: 404, statusText: "Not Found" }
        )
      );

      const provider = new OpenAIProvider("sk-test-key");

      await expect(provider.complete("test")).rejects.toThrow(
        /OpenAI Chat API error:/
      );
    });

    it("should use custom config when provided", async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse(createChatResponse("response", "stop", "gpt-4.1"))
      );

      const provider = new OpenAIProvider("sk-test-key");
      await provider.complete("test", {
        temperature: 0.5,
        maxTokens: 1000,
        model: "gpt-4.1",
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const callArgs = mockFetch.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(callArgs[1].body as string) as Record<
        string,
        unknown
      >;

      expect(body.temperature).toBe(0.5);
      expect(body.max_tokens).toBe(1000);
      expect(body.model).toBe("gpt-4.1");
    });

    it("should handle null content in response", async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse(createChatResponse(null, "stop"))
      );

      const provider = new OpenAIProvider("sk-test-key");
      const result = await provider.complete("test");

      expect(result.text).toBe("");
    });
  });

  // ---------------------------------------------------------------------------
  // checkAvailability() Tests
  // ---------------------------------------------------------------------------

  describe("checkAvailability()", () => {
    it("should return available: true on success (200)", async () => {
      const modelsResponse: OpenAIModelsResponse = {
        data: [{ id: "gpt-4.1" }, { id: "gpt-4.1-mini" }],
      };
      mockFetch.mockResolvedValueOnce(createMockResponse(modelsResponse));

      const provider = new OpenAIProvider("sk-test-key");
      const result = await provider.checkAvailability();

      expect(result.available).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it("should return available: false on API error", async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse(
          createErrorResponse("Invalid API key", "invalid_request_error"),
          { ok: false, status: 401, statusText: "Unauthorized" }
        )
      );

      const provider = new OpenAIProvider("sk-test-key");
      const result = await provider.checkAvailability();

      expect(result.available).toBe(false);
      expect(result.error).toContain("Invalid API key");
    });

    it("should return available: false on rate limit", async () => {
      const headers = new Map<string, string>();
      headers.set("retry-after", "30");

      mockFetch.mockResolvedValueOnce(
        createMockResponse(
          createErrorResponse("Rate limit exceeded", "rate_limit_error"),
          { ok: false, status: 429, statusText: "Too Many Requests", headers }
        )
      );

      const provider = new OpenAIProvider("sk-test-key");
      const result = await provider.checkAvailability();

      expect(result.available).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------
  // mapFinishReason() Tests (indirect through complete())
  // ---------------------------------------------------------------------------

  describe("mapFinishReason()", () => {
    it("should map 'stop' to 'stop'", async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse(createChatResponse("content", "stop"))
      );

      const provider = new OpenAIProvider("sk-test-key");
      const result = await provider.complete("test");

      expect(result.finishReason).toBe("stop");
    });

    it("should map 'length' to 'length'", async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse(createChatResponse("content", "length"))
      );

      const provider = new OpenAIProvider("sk-test-key");
      const result = await provider.complete("test");

      expect(result.finishReason).toBe("length");
    });

    it("should map 'content_filter' to 'content_filter'", async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse(createChatResponse("content", "content_filter"))
      );

      const provider = new OpenAIProvider("sk-test-key");
      const result = await provider.complete("test");

      expect(result.finishReason).toBe("content_filter");
    });

    it("should map 'tool_calls' to 'tool_use'", async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse(createChatResponse("content", "tool_calls"))
      );

      const provider = new OpenAIProvider("sk-test-key");
      const result = await provider.complete("test");

      expect(result.finishReason).toBe("tool_use");
    });

    it("should map unknown reason to 'unknown'", async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse(createChatResponse("content", "some_other_reason"))
      );

      const provider = new OpenAIProvider("sk-test-key");
      const result = await provider.complete("test");

      expect(result.finishReason).toBe("unknown");
    });
  });
});
