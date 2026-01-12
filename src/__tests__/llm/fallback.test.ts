import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  CompletionProviderWithFallback,
  createFallbackProvider,
} from "../../llm/fallback.js";
import type {
  LLMCompletionProvider,
  LLMProviderType,
  CompletionResult,
  ModelConfig,
} from "../../llm/types.js";
import { isLLMError, LLMErrorSubType } from "../../errors/index.js";

// =============================================================================
// Mock Helpers
// =============================================================================

/**
 * Создаёт mock провайдер для тестирования fallback логики
 * @param name - Имя провайдера
 * @param shouldFail - Должен ли провайдер выбросить ошибку
 * @param errorMsg - Сообщение об ошибке
 */
function createMockProvider(
  name: string,
  shouldFail: boolean,
  errorMsg?: string
): LLMCompletionProvider {
  return {
    name: name as LLMProviderType,
    complete: shouldFail
      ? vi.fn().mockRejectedValue(new Error(errorMsg ?? `${name} failed`))
      : vi
          .fn()
          .mockResolvedValue({
            text: `Response from ${name}`,
            tokenCount: 30,
            model: `${name}-model`,
            finishReason: "stop",
          } as CompletionResult),
    checkAvailability: shouldFail
      ? vi.fn().mockResolvedValue({ available: false, error: errorMsg })
      : vi.fn().mockResolvedValue({ available: true }),
  };
}

// =============================================================================
// Tests
// =============================================================================

describe("fallback.ts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ---------------------------------------------------------------------------
  // CompletionProviderWithFallback
  // ---------------------------------------------------------------------------

  describe("CompletionProviderWithFallback", () => {
    describe("constructor", () => {
      it("должен выбросить ошибку если не передано ни одного провайдера", () => {
        // ARRANGE & ACT & ASSERT
        expect(() => new CompletionProviderWithFallback([])).toThrow(
          "At least one provider required for fallback"
        );
      });

      it("должен установить name из первого провайдера", () => {
        // ARRANGE
        const provider1 = createMockProvider("openai", false);
        const provider2 = createMockProvider("gemini", false);

        // ACT
        const fallback = new CompletionProviderWithFallback([
          provider1,
          provider2,
        ]);

        // ASSERT
        expect(fallback.name).toBe("openai");
      });

      it("должен сохранить имена всех провайдеров в providerNames", () => {
        // ARRANGE
        const provider1 = createMockProvider("openai", false);
        const provider2 = createMockProvider("gemini", false);
        const provider3 = createMockProvider("anthropic", false);

        // ACT
        const fallback = new CompletionProviderWithFallback([
          provider1,
          provider2,
          provider3,
        ]);

        // ASSERT
        const providerNames = (fallback as any).providerNames as readonly string[];
        expect(providerNames).toEqual(["openai", "gemini", "anthropic"]);
      });
    });

    describe("complete()", () => {
      it("должен вернуть результат от первого провайдера при успехе", async () => {
        // ARRANGE
        const provider1 = createMockProvider("openai", false);
        const provider2 = createMockProvider("gemini", false);
        const fallback = new CompletionProviderWithFallback([
          provider1,
          provider2,
        ]);

        // ACT
        const result = await fallback.complete("test prompt");

        // ASSERT
        expect(result.text).toBe("Response from openai");
        expect(result.model).toBe("openai-model");
        expect(provider1.complete).toHaveBeenCalledTimes(1);
        expect(provider2.complete).not.toHaveBeenCalled();
      });

      it("должен переключиться на второй провайдер если первый упал", async () => {
        // ARRANGE
        const provider1 = createMockProvider(
          "openai",
          true,
          "OpenAI is down"
        );
        const provider2 = createMockProvider("gemini", false);
        const fallback = new CompletionProviderWithFallback([
          provider1,
          provider2,
        ]);

        // ACT
        const result = await fallback.complete("test prompt");

        // ASSERT
        expect(result.text).toBe("Response from gemini");
        expect(result.model).toBe("gemini-model");
        expect(provider1.complete).toHaveBeenCalledTimes(1);
        expect(provider2.complete).toHaveBeenCalledTimes(1);
      });

      it("должен переключиться на третий провайдер если первый и второй упали", async () => {
        // ARRANGE
        const provider1 = createMockProvider(
          "openai",
          true,
          "OpenAI is down"
        );
        const provider2 = createMockProvider(
          "gemini",
          true,
          "Gemini is down"
        );
        const provider3 = createMockProvider("anthropic", false);
        const fallback = new CompletionProviderWithFallback([
          provider1,
          provider2,
          provider3,
        ]);

        // ACT
        const result = await fallback.complete("test prompt");

        // ASSERT
        expect(result.text).toBe("Response from anthropic");
        expect(result.model).toBe("anthropic-model");
        expect(provider1.complete).toHaveBeenCalledTimes(1);
        expect(provider2.complete).toHaveBeenCalledTimes(1);
        expect(provider3.complete).toHaveBeenCalledTimes(1);
      });

      it("должен выбросить LLMError когда все провайдеры упали", async () => {
        // ARRANGE
        const provider1 = createMockProvider(
          "openai",
          true,
          "OpenAI is down"
        );
        const provider2 = createMockProvider(
          "gemini",
          true,
          "Gemini is down"
        );
        const fallback = new CompletionProviderWithFallback([
          provider1,
          provider2,
        ]);

        // ACT & ASSERT
        await expect(fallback.complete("test prompt")).rejects.toThrow(
          "All 2 providers failed"
        );

        // Проверяем тип ошибки
        try {
          await fallback.complete("test prompt 2");
        } catch (error) {
          expect(isLLMError(error)).toBe(true);
          if (isLLMError(error)) {
            expect(error.subType).toBe(LLMErrorSubType.API_ERROR);
            expect(error.provider).toBe("fallback");
          }
        }
      });

      it("должен включить все сообщения об ошибках провайдеров в финальную ошибку", async () => {
        // ARRANGE
        const provider1 = createMockProvider(
          "openai",
          true,
          "OpenAI timeout"
        );
        const provider2 = createMockProvider(
          "gemini",
          true,
          "Gemini auth failed"
        );
        const provider3 = createMockProvider(
          "anthropic",
          true,
          "Anthropic rate limit"
        );
        const fallback = new CompletionProviderWithFallback([
          provider1,
          provider2,
          provider3,
        ]);

        // ACT & ASSERT
        try {
          await fallback.complete("test prompt");
          expect.fail("Should have thrown an error");
        } catch (error) {
          if (isLLMError(error)) {
            const context = error.context as
              | { errors?: string[] }
              | undefined;
            expect(context?.errors).toBeDefined();
            expect(context?.errors).toHaveLength(3);
            expect(context?.errors?.[0]).toContain("openai");
            expect(context?.errors?.[0]).toContain("OpenAI timeout");
            expect(context?.errors?.[1]).toContain("gemini");
            expect(context?.errors?.[1]).toContain("Gemini auth failed");
            expect(context?.errors?.[2]).toContain("anthropic");
            expect(context?.errors?.[2]).toContain("Anthropic rate limit");
          }
        }
      });

      it("должен передать config в провайдеры", async () => {
        // ARRANGE
        const provider1 = createMockProvider("openai", false);
        const fallback = new CompletionProviderWithFallback([provider1]);
        const config: Partial<ModelConfig> = {
          temperature: 0.5,
          maxTokens: 1000,
        };

        // ACT
        await fallback.complete("test prompt", config);

        // ASSERT
        expect(provider1.complete).toHaveBeenCalledWith("test prompt", config);
      });

      it("должен обработать ошибку не-Error типа", async () => {
        // ARRANGE
        const provider = {
          name: "openai" as LLMProviderType,
          complete: vi.fn().mockRejectedValue("string error"),
          checkAvailability: vi.fn().mockResolvedValue({ available: true }),
        };
        const fallback = new CompletionProviderWithFallback([provider]);

        // ACT & ASSERT
        try {
          await fallback.complete("test");
          expect.fail("Should have thrown an error");
        } catch (error) {
          if (isLLMError(error)) {
            const context = error.context as
              | { errors?: string[] }
              | undefined;
            expect(context?.errors?.[0]).toContain("string error");
          }
        }
      });
    });

    describe("checkAvailability()", () => {
      it("должен вернуть available: true если хотя бы один провайдер доступен", async () => {
        // ARRANGE
        const provider1 = createMockProvider(
          "openai",
          true,
          "OpenAI down"
        );
        const provider2 = createMockProvider("gemini", false);
        const fallback = new CompletionProviderWithFallback([
          provider1,
          provider2,
        ]);

        // ACT
        const result = await fallback.checkAvailability();

        // ASSERT
        expect(result.available).toBe(true);
        expect(result.error).toBeUndefined();
      });

      it("должен вернуть available: false если все провайдеры недоступны", async () => {
        // ARRANGE
        const provider1 = createMockProvider(
          "openai",
          true,
          "OpenAI down"
        );
        const provider2 = createMockProvider(
          "gemini",
          true,
          "Gemini down"
        );
        const fallback = new CompletionProviderWithFallback([
          provider1,
          provider2,
        ]);

        // ACT
        const result = await fallback.checkAvailability();

        // ASSERT
        expect(result.available).toBe(false);
        expect(result.error).toBeDefined();
        expect(result.error).toContain("No providers available");
      });

      it("должен включить информацию о всех недоступных провайдерах в ошибку", async () => {
        // ARRANGE
        const provider1 = createMockProvider(
          "openai",
          true,
          "OpenAI timeout"
        );
        const provider2 = createMockProvider(
          "gemini",
          true,
          "Gemini auth error"
        );
        const fallback = new CompletionProviderWithFallback([
          provider1,
          provider2,
        ]);

        // ACT
        const result = await fallback.checkAvailability();

        // ASSERT
        expect(result.available).toBe(false);
        expect(result.error).toContain("openai");
        expect(result.error).toContain("OpenAI timeout");
        expect(result.error).toContain("gemini");
        expect(result.error).toContain("Gemini auth error");
      });

      it("должен вернуть available: true при первом доступном провайдере и не проверять остальные", async () => {
        // ARRANGE
        const provider1 = createMockProvider("openai", false);
        const provider2 = createMockProvider("gemini", false);
        const fallback = new CompletionProviderWithFallback([
          provider1,
          provider2,
        ]);

        // ACT
        const result = await fallback.checkAvailability();

        // ASSERT
        expect(result.available).toBe(true);
        expect(provider1.checkAvailability).toHaveBeenCalledTimes(1);
        expect(provider2.checkAvailability).not.toHaveBeenCalled();
      });

      it("должен обработать исключение из checkAvailability провайдера", async () => {
        // ARRANGE
        const provider = {
          name: "openai" as LLMProviderType,
          complete: vi.fn().mockResolvedValue({
            text: "test",
            tokenCount: 10,
            model: "test",
            finishReason: "stop",
          }),
          checkAvailability: vi
            .fn()
            .mockRejectedValue(new Error("Network error")),
        };
        const fallback = new CompletionProviderWithFallback([provider]);

        // ACT
        const result = await fallback.checkAvailability();

        // ASSERT
        expect(result.available).toBe(false);
        expect(result.error).toContain("openai");
        expect(result.error).toContain("Network error");
      });

      it("должен обработать провайдер с undefined error", async () => {
        // ARRANGE
        const provider = {
          name: "openai" as LLMProviderType,
          complete: vi.fn().mockResolvedValue({
            text: "test",
            tokenCount: 10,
            model: "test",
            finishReason: "stop",
          }),
          checkAvailability: vi
            .fn()
            .mockResolvedValue({ available: false, error: undefined }),
        };
        const fallback = new CompletionProviderWithFallback([provider]);

        // ACT
        const result = await fallback.checkAvailability();

        // ASSERT
        expect(result.available).toBe(false);
        expect(result.error).toContain("unknown error");
      });
    });
  });

  // ---------------------------------------------------------------------------
  // createFallbackProvider
  // ---------------------------------------------------------------------------

  describe("createFallbackProvider()", () => {
    it("должен выбросить ошибку если передан пустой массив провайдеров", () => {
      // ARRANGE & ACT & ASSERT
      expect(() => createFallbackProvider([])).toThrow(
        "At least one provider required for fallback"
      );
    });

    it("должен вернуть экземпляр CompletionProviderWithFallback", () => {
      // ARRANGE
      const provider = createMockProvider("openai", false);

      // ACT
      const fallback = createFallbackProvider([provider]);

      // ASSERT
      expect(fallback).toBeInstanceOf(CompletionProviderWithFallback);
    });

    it("должен создать fallback с несколькими провайдерами", () => {
      // ARRANGE
      const provider1 = createMockProvider("openai", false);
      const provider2 = createMockProvider("gemini", false);
      const provider3 = createMockProvider("anthropic", false);

      // ACT
      const fallback = createFallbackProvider([
        provider1,
        provider2,
        provider3,
      ]);

      // ASSERT
      expect(fallback).toBeInstanceOf(CompletionProviderWithFallback);
      expect(fallback.name).toBe("openai");
    });

    it("должен создать fallback который работает корректно", async () => {
      // ARRANGE
      const provider1 = createMockProvider("openai", true, "OpenAI down");
      const provider2 = createMockProvider("gemini", false);
      const fallback = createFallbackProvider([provider1, provider2]);

      // ACT
      const result = await fallback.complete("test");

      // ASSERT
      expect(result.text).toBe("Response from gemini");
    });
  });
});
