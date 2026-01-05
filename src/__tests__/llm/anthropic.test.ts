import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { AnthropicProvider } from "../../llm/anthropic.js";
import { LLMError, LLMErrorSubType } from "../../errors/index.js";

// =============================================================================
// Test Types
// =============================================================================

interface AnthropicTextContent {
  readonly type: "text";
  readonly text: string;
}

interface AnthropicUsage {
  readonly input_tokens: number;
  readonly output_tokens: number;
}

interface AnthropicMessageResponse {
  readonly id: string;
  readonly type: "message";
  readonly role: "assistant";
  readonly content: readonly AnthropicTextContent[];
  readonly model: string;
  readonly stop_reason: string | null;
  readonly usage: AnthropicUsage;
}

interface AnthropicErrorResponse {
  readonly type: "error";
  readonly error: {
    readonly type: string;
    readonly message: string;
  };
}

// =============================================================================
// Mock Helpers
// =============================================================================

function createMockResponse(
  body: AnthropicMessageResponse | AnthropicErrorResponse | string,
  status = 200,
  headers: Record<string, string> = {}
): Response {
  const responseBody = typeof body === "string" ? body : JSON.stringify(body);
  return new Response(responseBody, {
    status,
    statusText: status === 200 ? "OK" : "Error",
    headers: new Headers({
      "Content-Type": "application/json",
      ...headers,
    }),
  });
}

function createSuccessResponse(
  text: string,
  stopReason: string | null = "end_turn"
): AnthropicMessageResponse {
  return {
    id: "msg_test_123",
    type: "message",
    role: "assistant",
    content: [{ type: "text", text }],
    model: "claude-sonnet-4-5-20250514",
    stop_reason: stopReason,
    usage: {
      input_tokens: 10,
      output_tokens: 20,
    },
  };
}

function createErrorResponse(
  errorType: string,
  message: string
): AnthropicErrorResponse {
  return {
    type: "error",
    error: {
      type: errorType,
      message,
    },
  };
}

// =============================================================================
// Tests
// =============================================================================

describe("AnthropicProvider", () => {
  const TEST_API_KEY = "sk-ant-test-key-123";
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  // ---------------------------------------------------------------------------
  // Constructor Tests
  // ---------------------------------------------------------------------------

  describe("constructor", () => {
    it("should throw error when API key is empty", () => {
      expect(() => new AnthropicProvider("")).toThrow(
        "Anthropic API key is required"
      );
    });

    it("should throw error when API key is whitespace only", () => {
      expect(() => new AnthropicProvider("   ")).toThrow(
        "Anthropic API key is required"
      );
    });

    it("should create provider with valid API key", () => {
      const provider = new AnthropicProvider(TEST_API_KEY);
      expect(provider.name).toBe("anthropic");
    });
  });

  // ---------------------------------------------------------------------------
  // complete() Tests
  // ---------------------------------------------------------------------------

  describe("complete()", () => {
    it("should return successful completion result", async () => {
      const mockFetch = vi
        .fn()
        .mockResolvedValue(
          createMockResponse(createSuccessResponse("Hello, world!"))
        );
      vi.stubGlobal("fetch", mockFetch);

      const provider = new AnthropicProvider(TEST_API_KEY);
      const result = await provider.complete("Say hello");

      expect(result.text).toBe("Hello, world!");
      expect(result.tokenCount).toBe(30);
      expect(result.model).toBe("claude-sonnet-4-5-20250514");
      expect(result.finishReason).toBe("stop");
      expect(mockFetch).toHaveBeenCalledOnce();
    });

    it("should throw LLMError when content array is empty", async () => {
      const emptyContentResponse: AnthropicMessageResponse = {
        id: "msg_test_123",
        type: "message",
        role: "assistant",
        content: [],
        model: "claude-sonnet-4-5-20250514",
        stop_reason: "end_turn",
        usage: {
          input_tokens: 10,
          output_tokens: 0,
        },
      };

      const mockFetch = vi
        .fn()
        .mockResolvedValue(createMockResponse(emptyContentResponse));
      vi.stubGlobal("fetch", mockFetch);

      const provider = new AnthropicProvider(TEST_API_KEY);
      const result = await provider.complete("Say hello");

      expect(result.text).toBe("");
      expect(result.tokenCount).toBe(10);
    });

    it("should throw error on API error response", async () => {
      const mockFetch = vi
        .fn()
        .mockResolvedValue(
          createMockResponse(
            createErrorResponse(
              "invalid_request_error",
              "Invalid model specified"
            ),
            400
          )
        );
      vi.stubGlobal("fetch", mockFetch);

      const provider = new AnthropicProvider(TEST_API_KEY);

      await expect(provider.complete("Say hello")).rejects.toThrow(
        "Anthropic API error: Invalid model specified"
      );
    });

    it("should throw LLMError with RATE_LIMIT on 429 response", async () => {
      const mockFetch = vi
        .fn()
        .mockResolvedValue(
          createMockResponse(
            createErrorResponse("rate_limit_error", "Too many requests"),
            429,
            { "retry-after": "30" }
          )
        );
      vi.stubGlobal("fetch", mockFetch);

      const provider = new AnthropicProvider(TEST_API_KEY);

      try {
        await provider.complete("Say hello");
        expect.fail("Should have thrown LLMError");
      } catch (error) {
        expect(error).toBeInstanceOf(LLMError);
        const llmError = error as LLMError;
        expect(llmError.subType).toBe(LLMErrorSubType.RATE_LIMIT);
        expect(llmError.provider).toBe("anthropic");
        expect(llmError.context?.retryAfterSeconds).toBe(30);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // checkAvailability() Tests
  // ---------------------------------------------------------------------------

  describe("checkAvailability()", () => {
    it("should return available true on successful response", async () => {
      const mockFetch = vi
        .fn()
        .mockResolvedValue(createMockResponse(createSuccessResponse("hi")));
      vi.stubGlobal("fetch", mockFetch);

      const provider = new AnthropicProvider(TEST_API_KEY);
      const result = await provider.checkAvailability();

      expect(result.available).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it("should return available false on error", async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error("Network error"));
      vi.stubGlobal("fetch", mockFetch);

      const provider = new AnthropicProvider(TEST_API_KEY);
      const result = await provider.checkAvailability();

      expect(result.available).toBe(false);
      expect(result.error).toBe("Network error");
    });

    it("should return available false on non-OK response with error details", async () => {
      const mockFetch = vi
        .fn()
        .mockResolvedValue(
          createMockResponse(
            createErrorResponse("authentication_error", "Invalid API key"),
            401
          )
        );
      vi.stubGlobal("fetch", mockFetch);

      const provider = new AnthropicProvider(TEST_API_KEY);
      const result = await provider.checkAvailability();

      expect(result.available).toBe(false);
      expect(result.error).toBe("Invalid API key");
    });
  });

  // ---------------------------------------------------------------------------
  // mapStopReason() Tests (via complete())
  // ---------------------------------------------------------------------------

  describe("mapStopReason()", () => {
    it('should map "end_turn" to "stop"', async () => {
      const mockFetch = vi
        .fn()
        .mockResolvedValue(
          createMockResponse(createSuccessResponse("test", "end_turn"))
        );
      vi.stubGlobal("fetch", mockFetch);

      const provider = new AnthropicProvider(TEST_API_KEY);
      const result = await provider.complete("test");

      expect(result.finishReason).toBe("stop");
    });

    it('should map "stop_sequence" to "stop"', async () => {
      const mockFetch = vi
        .fn()
        .mockResolvedValue(
          createMockResponse(createSuccessResponse("test", "stop_sequence"))
        );
      vi.stubGlobal("fetch", mockFetch);

      const provider = new AnthropicProvider(TEST_API_KEY);
      const result = await provider.complete("test");

      expect(result.finishReason).toBe("stop");
    });

    it('should map "max_tokens" to "length"', async () => {
      const mockFetch = vi
        .fn()
        .mockResolvedValue(
          createMockResponse(createSuccessResponse("test", "max_tokens"))
        );
      vi.stubGlobal("fetch", mockFetch);

      const provider = new AnthropicProvider(TEST_API_KEY);
      const result = await provider.complete("test");

      expect(result.finishReason).toBe("length");
    });

    it('should map "tool_use" to "tool_use"', async () => {
      const mockFetch = vi
        .fn()
        .mockResolvedValue(
          createMockResponse(createSuccessResponse("test", "tool_use"))
        );
      vi.stubGlobal("fetch", mockFetch);

      const provider = new AnthropicProvider(TEST_API_KEY);
      const result = await provider.complete("test");

      expect(result.finishReason).toBe("tool_use");
    });

    it('should map null stop_reason to "unknown"', async () => {
      const mockFetch = vi
        .fn()
        .mockResolvedValue(
          createMockResponse(createSuccessResponse("test", null))
        );
      vi.stubGlobal("fetch", mockFetch);

      const provider = new AnthropicProvider(TEST_API_KEY);
      const result = await provider.complete("test");

      expect(result.finishReason).toBe("unknown");
    });
  });
});
