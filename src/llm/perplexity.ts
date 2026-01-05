import { z } from "zod";
import {
  BaseCompletionProvider,
  BaseProviderConfigSchema,
  safeParseJSON,
  handleRateLimitResponse,
} from "./base.js";
import type { CompletionResult, ModelConfig, FinishReason } from "./types.js";

// =============================================================================
// Perplexity API Types
// =============================================================================

/**
 * Supported Perplexity models
 * @see https://docs.perplexity.ai/docs/model-cards
 */
export const PerplexityModelSchema = z.enum(["sonar-pro", "sonar"]);
export type PerplexityModel = z.infer<typeof PerplexityModelSchema>;

/**
 * Perplexity API response (OpenAI-compatible format)
 */
const PerplexityResponseSchema = z.object({
  choices: z.array(
    z.object({
      message: z.object({
        content: z.string(),
      }),
      finish_reason: z.enum(["stop", "length"]),
    })
  ),
  usage: z.object({
    total_tokens: z.number(),
  }),
  model: z.string(),
});

/**
 * Perplexity API error response
 */
const PerplexityErrorSchema = z.object({
  error: z.object({
    message: z.string(),
    type: z.string().optional(),
    code: z.string().optional(),
  }),
});

// =============================================================================
// Provider Configuration
// =============================================================================

const PERPLEXITY_BASE_URL = "https://api.perplexity.ai";
const DEFAULT_TIMEOUT = 60000;
const DEFAULT_MODEL: PerplexityModel = "sonar-pro";

// =============================================================================
// Perplexity Provider
// =============================================================================

/**
 * Perplexity AI provider for text completions
 * @remarks
 * - Uses OpenAI-compatible chat completions API
 * - Supports sonar-pro and sonar models
 * - Completion-only provider - embeddings are not available
 *
 * @example
 * ```typescript
 * const provider = new PerplexityProvider({ apiKey: "pplx-xxx" });
 * const result = await provider.complete("What is TypeScript?");
 * console.log(result.text);
 * ```
 */
export class PerplexityProvider extends BaseCompletionProvider {
  readonly name = "perplexity" as const;

  private readonly chatModel: PerplexityModel;

  /**
   * Create a new Perplexity provider instance
   * @param config - Provider configuration
   * @param config.apiKey - Perplexity API key (starts with pplx-)
   * @param config.chatModel - Model to use for completions (default: sonar-pro)
   * @param config.timeout - Request timeout in ms (default: 60000)
   */
  constructor(config: {
    apiKey: string;
    chatModel?: PerplexityModel;
    timeout?: number;
  }) {
    const validatedConfig = BaseProviderConfigSchema.parse({
      apiKey: config.apiKey,
      baseUrl: PERPLEXITY_BASE_URL,
      timeout: config.timeout ?? DEFAULT_TIMEOUT,
    });

    super(validatedConfig);

    this.chatModel = config.chatModel
      ? PerplexityModelSchema.parse(config.chatModel)
      : DEFAULT_MODEL;
  }

  /**
   * Generate text completion using Perplexity API
   * @param prompt - Input prompt
   * @param config - Optional model configuration overrides
   * @returns Completion result with text, token count, and finish reason
   * @throws Error on API failure or invalid response
   */
  async complete(
    prompt: string,
    config?: Partial<ModelConfig>
  ): Promise<CompletionResult> {
    const model = config?.model ?? this.chatModel;
    const temperature = config?.temperature ?? 0.7;
    const maxTokens = config?.maxTokens ?? 4096;

    const requestBody = {
      model,
      messages: [{ role: "user", content: prompt }],
      temperature,
      max_tokens: maxTokens,
    };

    const response = await this.fetchWithTimeout(
      `${this.baseUrl}/chat/completions`,
      {
        method: "POST",
        headers: this.buildAuthHeaders(),
        body: JSON.stringify(requestBody),
      }
    );

    handleRateLimitResponse(response, "perplexity");

    if (!response.ok) {
      const errorText = await response.text();
      try {
        const errorData = safeParseJSON<unknown>(errorText);
        const parsed = PerplexityErrorSchema.safeParse(errorData);

        if (parsed.success) {
          throw new Error(
            `Perplexity API error: ${parsed.data.error.message} (${parsed.data.error.type ?? "unknown"})`
          );
        }
      } catch (parseError) {
        // If it's already an Error from the safeParse branch, rethrow
        if (
          parseError instanceof Error &&
          parseError.message.startsWith("Perplexity API error:")
        ) {
          throw parseError;
        }
      }

      throw new Error(
        `Perplexity API error: ${response.status} ${response.statusText}`
      );
    }

    const responseText = await response.text();
    const data = safeParseJSON<unknown>(
      responseText,
      "Perplexity returned invalid JSON response"
    );
    const validated = PerplexityResponseSchema.parse(data);

    const choice = validated.choices[0];
    if (!choice) {
      throw new Error("Perplexity API returned empty response");
    }

    return {
      text: choice.message.content,
      tokenCount: validated.usage.total_tokens,
      model: validated.model,
      finishReason: this.mapFinishReason(choice.finish_reason),
    };
  }

  /**
   * Check if the provider is available and properly configured
   * @returns Availability status with optional error message
   */
  async checkAvailability(): Promise<{ available: boolean; error?: string }> {
    try {
      // Simple test request with minimal tokens
      await this.complete("Hi", {
        maxTokens: 5,
        temperature: 0,
      });
      return { available: true };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown error occurred";
      return { available: false, error: message };
    }
  }

  /**
   * Map Perplexity finish_reason to our FinishReason type
   * @param reason - Perplexity API finish reason
   * @returns Normalized FinishReason
   */
  private mapFinishReason(reason: "stop" | "length"): FinishReason {
    switch (reason) {
      case "stop":
        return "stop";
      case "length":
        return "length";
      default:
        return "unknown";
    }
  }
}
