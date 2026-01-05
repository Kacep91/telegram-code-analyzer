import { describe, it, expect } from "vitest";
import { safeParseJSON, handleRateLimitResponse } from "../../llm/base.js";
import { LLMError, LLMErrorSubType } from "../../errors/index.js";

// =============================================================================
// Mock Response Factory
// =============================================================================

interface MockResponseOptions {
  status: number;
  headers?: Record<string, string>;
}

function createMockResponse(options: MockResponseOptions): Response {
  const headers = new Headers(options.headers ?? {});
  return {
    status: options.status,
    headers,
    ok: options.status >= 200 && options.status < 300,
  } as Response;
}

// =============================================================================
// safeParseJSON Tests
// =============================================================================

describe("safeParseJSON", () => {
  describe("valid JSON", () => {
    it("should parse valid JSON and return typed object", () => {
      interface TestData {
        name: string;
        value: number;
      }

      const jsonString = '{"name": "test", "value": 42}';
      const result = safeParseJSON<TestData>(jsonString);

      expect(result).toEqual({ name: "test", value: 42 });
      expect(result.name).toBe("test");
      expect(result.value).toBe(42);
    });
  });

  describe("invalid JSON", () => {
    it("should throw Error with fallback message for invalid JSON", () => {
      const invalidJson = "not a valid json {";
      const fallbackMessage = "Custom error message for invalid response";

      expect(() => safeParseJSON(invalidJson, fallbackMessage)).toThrowError(
        fallbackMessage
      );
    });

    it("should throw Error with default message when fallback is not provided", () => {
      const invalidJson = "broken json content";

      expect(() => safeParseJSON(invalidJson)).toThrowError(
        /Invalid JSON response:/
      );
    });
  });

  describe("empty string", () => {
    it("should throw Error with fallback message for empty string", () => {
      const emptyString = "";
      const fallbackMessage = "Response body was empty";

      expect(() => safeParseJSON(emptyString, fallbackMessage)).toThrowError(
        fallbackMessage
      );
    });
  });
});

// =============================================================================
// handleRateLimitResponse Tests
// =============================================================================

describe("handleRateLimitResponse", () => {
  const providerName = "TestProvider";

  describe("status 429 with retry-after header", () => {
    it("should throw LLMError with retryAfterSeconds from header", () => {
      const response = createMockResponse({
        status: 429,
        headers: { "retry-after": "60" },
      });

      expect(() => handleRateLimitResponse(response, providerName)).toThrow(
        LLMError
      );

      try {
        handleRateLimitResponse(response, providerName);
      } catch (error) {
        expect(error).toBeInstanceOf(LLMError);
        const llmError = error as LLMError;
        expect(llmError.subType).toBe(LLMErrorSubType.RATE_LIMIT);
        expect(llmError.provider).toBe(providerName);
        expect(llmError.context?.retryAfterSeconds).toBe(60);
        expect(llmError.message).toContain("60 seconds");
      }
    });
  });

  describe("status 429 without retry-after header", () => {
    it("should throw LLMError with null retryAfterSeconds", () => {
      const response = createMockResponse({
        status: 429,
      });

      expect(() => handleRateLimitResponse(response, providerName)).toThrow(
        LLMError
      );

      try {
        handleRateLimitResponse(response, providerName);
      } catch (error) {
        expect(error).toBeInstanceOf(LLMError);
        const llmError = error as LLMError;
        expect(llmError.subType).toBe(LLMErrorSubType.RATE_LIMIT);
        expect(llmError.provider).toBe(providerName);
        expect(llmError.context?.retryAfterSeconds).toBeNull();
        expect(llmError.message).toContain("unknown");
      }
    });
  });

  describe("status 200 (success)", () => {
    it("should not throw error for successful response", () => {
      const response = createMockResponse({
        status: 200,
      });

      expect(() =>
        handleRateLimitResponse(response, providerName)
      ).not.toThrow();
    });
  });
});
