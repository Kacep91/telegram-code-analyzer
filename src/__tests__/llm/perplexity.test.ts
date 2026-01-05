import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PerplexityProvider } from "../../llm/perplexity.js";
import { LLMError, LLMErrorSubType } from "../../errors/index.js";

// =============================================================================
// Test Types
// =============================================================================

interface PerplexityAPIChoice {
  message: { content: string };
  finish_reason: "stop" | "length";
}

interface PerplexityAPIResponse {
  choices: PerplexityAPIChoice[];
  usage: { total_tokens: number };
  model: string;
}

interface PerplexityAPIErrorResponse {
  error: {
    message: string;
    type?: string | undefined;
    code?: string | undefined;
  };
}

// =============================================================================
// Mock Helpers
// =============================================================================

function createMockResponse(
  body: PerplexityAPIResponse | PerplexityAPIErrorResponse | string,
  status = 200,
  headers: Record<string, string> = {}
): Response {
  const responseHeaders = new Headers(headers);
  const bodyString = typeof body === "string" ? body : JSON.stringify(body);

  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    headers: responseHeaders,
    text: vi.fn().mockResolvedValue(bodyString),
    json: vi.fn().mockResolvedValue(typeof body === "string" ? {} : body),
  } as unknown as Response;
}

function createSuccessResponse(
  content: string,
  finishReason: "stop" | "length" = "stop",
  totalTokens = 100,
  model = "sonar-pro"
): Response {
  const body: PerplexityAPIResponse = {
    choices: [
      {
        message: { content },
        finish_reason: finishReason,
      },
    ],
    usage: { total_tokens: totalTokens },
    model,
  };
  return createMockResponse(body);
}

function createErrorResponse(
  message: string,
  status: number,
  type?: string,
  headers: Record<string, string> = {}
): Response {
  const body: PerplexityAPIErrorResponse = {
    error: { message, type },
  };
  return createMockResponse(body, status, headers);
}

function createEmptyChoicesResponse(): Response {
  const body: PerplexityAPIResponse = {
    choices: [],
    usage: { total_tokens: 0 },
    model: "sonar-pro",
  };
  return createMockResponse(body);
}

// =============================================================================
// Tests
// =============================================================================

describe("PerplexityProvider", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetAllMocks();
  });

  // ---------------------------------------------------------------------------
  // Constructor Tests
  // ---------------------------------------------------------------------------

  describe("constructor", () => {
    it("should throw LLMError when API key is empty", () => {
      expect(() => new PerplexityProvider({ apiKey: "" })).toThrow();
    });

    it("should create provider with valid API key", () => {
      const provider = new PerplexityProvider({ apiKey: "pplx-test-key" });
      expect(provider.name).toBe("perplexity");
    });

    it("should accept custom model", () => {
      const provider = new PerplexityProvider({
        apiKey: "pplx-test-key",
        chatModel: "sonar",
      });
      expect(provider.name).toBe("perplexity");
    });
  });

  // ---------------------------------------------------------------------------
  // complete() Tests
  // ---------------------------------------------------------------------------

  describe("complete()", () => {
    it("should return successful completion result", async () => {
      const expectedContent = "TypeScript is a typed superset of JavaScript.";
      mockFetch.mockResolvedValueOnce(
        createSuccessResponse(expectedContent, "stop", 150, "sonar-pro")
      );

      const provider = new PerplexityProvider({ apiKey: "pplx-test-key" });
      const result = await provider.complete("What is TypeScript?");

      expect(result.text).toBe(expectedContent);
      expect(result.tokenCount).toBe(150);
      expect(result.model).toBe("sonar-pro");
      expect(result.finishReason).toBe("stop");

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("https://api.perplexity.ai/chat/completions");
      expect(options.method).toBe("POST");
      expect(options.headers).toEqual({
        Authorization: "Bearer pplx-test-key",
        "Content-Type": "application/json",
      });
    });

    it("should throw error when API returns empty choices", async () => {
      mockFetch.mockResolvedValueOnce(createEmptyChoicesResponse());

      const provider = new PerplexityProvider({ apiKey: "pplx-test-key" });

      await expect(provider.complete("Test prompt")).rejects.toThrow(
        "Perplexity API returned empty response"
      );
    });

    it("should throw error on API failure", async () => {
      mockFetch.mockResolvedValueOnce(
        createErrorResponse("Invalid API key", 401, "authentication_error")
      );

      const provider = new PerplexityProvider({ apiKey: "invalid-key" });

      await expect(provider.complete("Test prompt")).rejects.toThrow(
        "Perplexity API error: Invalid API key (authentication_error)"
      );
    });

    it("should throw LLMError on rate limit (429)", async () => {
      mockFetch.mockResolvedValueOnce(
        createErrorResponse("Rate limit exceeded", 429, "rate_limit_error", {
          "retry-after": "30",
        })
      );

      const provider = new PerplexityProvider({ apiKey: "pplx-test-key" });

      try {
        await provider.complete("Test prompt");
        expect.fail("Should have thrown an error");
      } catch (error) {
        expect(error).toBeInstanceOf(LLMError);
        const llmError = error as LLMError;
        expect(llmError.subType).toBe(LLMErrorSubType.RATE_LIMIT);
        expect(llmError.provider).toBe("perplexity");
      }
    });

    it("should use custom config parameters", async () => {
      mockFetch.mockResolvedValueOnce(
        createSuccessResponse("Response", "length", 50)
      );

      const provider = new PerplexityProvider({ apiKey: "pplx-test-key" });
      await provider.complete("Test", {
        model: "sonar",
        temperature: 0.5,
        maxTokens: 2048,
      });

      const [, options] = mockFetch.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(options.body as string) as Record<
        string,
        unknown
      >;
      expect(body.model).toBe("sonar");
      expect(body.temperature).toBe(0.5);
      expect(body.max_tokens).toBe(2048);
    });

    it("should handle non-JSON error response", async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse("Internal Server Error", 500)
      );

      const provider = new PerplexityProvider({ apiKey: "pplx-test-key" });

      await expect(provider.complete("Test prompt")).rejects.toThrow(
        "Perplexity API error: 500 Error"
      );
    });
  });

  // ---------------------------------------------------------------------------
  // checkAvailability() Tests
  // ---------------------------------------------------------------------------

  describe("checkAvailability()", () => {
    it("should return available: true on successful request", async () => {
      mockFetch.mockResolvedValueOnce(createSuccessResponse("Hi", "stop", 5));

      const provider = new PerplexityProvider({ apiKey: "pplx-test-key" });
      const result = await provider.checkAvailability();

      expect(result.available).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it("should return available: false on error", async () => {
      mockFetch.mockResolvedValueOnce(
        createErrorResponse("Invalid API key", 401, "authentication_error")
      );

      const provider = new PerplexityProvider({ apiKey: "invalid-key" });
      const result = await provider.checkAvailability();

      expect(result.available).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error).toContain("Invalid API key");
    });

    it("should return available: false on network error", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      const provider = new PerplexityProvider({ apiKey: "pplx-test-key" });
      const result = await provider.checkAvailability();

      expect(result.available).toBe(false);
      expect(result.error).toBe("Network error");
    });
  });

  // ---------------------------------------------------------------------------
  // mapFinishReason() Tests (tested via complete())
  // ---------------------------------------------------------------------------

  describe("mapFinishReason()", () => {
    it("should map 'stop' to 'stop'", async () => {
      mockFetch.mockResolvedValueOnce(
        createSuccessResponse("Response", "stop")
      );

      const provider = new PerplexityProvider({ apiKey: "pplx-test-key" });
      const result = await provider.complete("Test");

      expect(result.finishReason).toBe("stop");
    });

    it("should map 'length' to 'length'", async () => {
      mockFetch.mockResolvedValueOnce(
        createSuccessResponse("Response", "length")
      );

      const provider = new PerplexityProvider({ apiKey: "pplx-test-key" });
      const result = await provider.complete("Test");

      expect(result.finishReason).toBe("length");
    });
  });
});
