/**
 * Fallback wrapper for completion providers
 * @module src/llm/fallback
 */

import type {
  LLMCompletionProvider,
  CompletionResult,
  ModelConfig,
  LLMProviderType,
} from "./types.js";
import { LLMError, LLMErrorSubType } from "../errors/index.js";

// =============================================================================
// Fallback Provider
// =============================================================================

/**
 * Completion provider that tries multiple providers in order
 *
 * @remarks
 * Wraps multiple completion providers and tries each one in order
 * until one succeeds. Useful for handling provider outages.
 *
 * @example
 * ```typescript
 * const fallback = new CompletionProviderWithFallback([
 *   openaiProvider,
 *   anthropicProvider,
 *   geminiProvider,
 * ]);
 *
 * // Will try OpenAI first, then Anthropic, then Gemini
 * const result = await fallback.complete("Hello!");
 * ```
 */
export class CompletionProviderWithFallback implements LLMCompletionProvider {
  readonly name: LLMProviderType = "openai"; // Default, will use first provider's name

  private readonly providerNames: readonly string[];

  /**
   * Create a fallback provider
   * @param providers - Array of providers to try in order
   * @throws Error if no providers are provided
   */
  constructor(private readonly providers: readonly LLMCompletionProvider[]) {
    if (providers.length === 0) {
      throw new Error("At least one provider required for fallback");
    }
    this.providerNames = providers.map((p) => p.name);
  }

  /**
   * Generate completion, trying each provider until one succeeds
   * @param prompt - Input prompt
   * @param config - Optional model configuration
   * @returns Completion result from first successful provider
   * @throws LLMError if all providers fail
   */
  async complete(
    prompt: string,
    config?: Partial<ModelConfig>
  ): Promise<CompletionResult> {
    const errors: Array<{ provider: string; error: Error }> = [];

    for (const provider of this.providers) {
      try {
        return await provider.complete(prompt, config);
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        errors.push({ provider: provider.name, error: err });
        console.warn(
          `[Fallback] ${provider.name} failed: ${err.message}, trying next...`
        );
      }
    }

    // All providers failed
    const errorMessages = errors.map((e) => `${e.provider}: ${e.error.message}`);
    throw new LLMError(
      `All ${this.providers.length} providers failed`,
      LLMErrorSubType.API_ERROR,
      "fallback",
      {
        providers: this.providerNames,
        errors: errorMessages,
      }
    );
  }

  /**
   * Check if any provider is available
   * @returns Availability status
   */
  async checkAvailability(): Promise<{ available: boolean; error?: string }> {
    const unavailableProviders: string[] = [];

    for (const provider of this.providers) {
      try {
        const result = await provider.checkAvailability();
        if (result.available) {
          return { available: true };
        }
        unavailableProviders.push(
          `${provider.name}: ${result.error ?? "unknown error"}`
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : "unknown error";
        unavailableProviders.push(`${provider.name}: ${message}`);
      }
    }

    return {
      available: false,
      error: `No providers available: ${unavailableProviders.join("; ")}`,
    };
  }
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create a fallback provider from an array of providers
 * @param providers - Providers to use (at least one required)
 * @returns CompletionProviderWithFallback instance
 * @throws Error if providers array is empty
 *
 * @example
 * ```typescript
 * const fallback = createFallbackProvider([
 *   new OpenAIProvider(key1),
 *   new AnthropicProvider(key2),
 * ]);
 * ```
 */
export function createFallbackProvider(
  providers: readonly LLMCompletionProvider[]
): CompletionProviderWithFallback {
  return new CompletionProviderWithFallback(providers);
}
