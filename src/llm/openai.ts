import { z } from "zod";
import { BaseFullProvider, handleRateLimitResponse } from "./base.js";
import type {
  EmbeddingResult,
  CompletionResult,
  ModelConfig,
  FinishReason,
} from "./types.js";

// =============================================================================
// OpenAI API Response Schemas (Zod validation)
// =============================================================================

/** OpenAI embedding API response schema */
const OpenAIEmbeddingResponseSchema = z.object({
  data: z.array(
    z.object({
      embedding: z.array(z.number()),
      index: z.number(),
    })
  ),
  usage: z.object({
    total_tokens: z.number(),
  }),
  model: z.string(),
});

/** OpenAI chat completion API response schema */
const OpenAIChatResponseSchema = z.object({
  choices: z.array(
    z.object({
      message: z.object({
        content: z.string().nullable(),
      }),
      finish_reason: z.string(),
    })
  ),
  usage: z.object({
    total_tokens: z.number(),
  }),
  model: z.string(),
});

/** OpenAI API error response schema */
const OpenAIErrorResponseSchema = z.object({
  error: z.object({
    message: z.string(),
    type: z.string(),
    code: z.string().nullable(),
  }),
});

// =============================================================================
// OpenAI Provider Implementation
// =============================================================================

/**
 * OpenAI LLM provider for embeddings and chat completions
 * @remarks Full provider with embedding support. Supports text-embedding-3-large, gpt-4.1, gpt-4.1-mini models
 */
export class OpenAIProvider extends BaseFullProvider {
  readonly name = "openai" as const;

  private readonly embeddingModel: string;
  private readonly chatModel: string;

  /**
   * Create OpenAI provider instance
   * @param apiKey - OpenAI API key
   * @param embeddingModel - Model for embeddings (default: text-embedding-3-large)
   * @param chatModel - Model for completions (default: gpt-4.1-mini)
   * @param timeout - Request timeout in milliseconds (default: 60000)
   */
  constructor(
    apiKey: string,
    embeddingModel = "text-embedding-3-large",
    chatModel = "gpt-4.1-mini",
    timeout = 60000
  ) {
    super({
      apiKey,
      baseUrl: "https://api.openai.com/v1",
      timeout,
    });
    this.embeddingModel = embeddingModel;
    this.chatModel = chatModel;
  }

  /**
   * Generate embedding for a single text
   * @param text - Input text to embed
   * @returns Embedding result with values, token count, and model
   * @throws Error if embedding generation fails
   */
  async embed(text: string): Promise<EmbeddingResult> {
    const results = await this.embedBatch([text]);
    const result = results[0];

    if (!result) {
      throw new Error("OpenAI returned empty embedding result");
    }

    return result;
  }

  /**
   * Generate embeddings for multiple texts in a single API call
   * @param texts - Array of texts to embed
   * @returns Array of embedding results
   * @throws Error on API failure
   */
  async embedBatch(
    texts: readonly string[]
  ): Promise<readonly EmbeddingResult[]> {
    if (texts.length === 0) {
      return [];
    }

    const response = await this.fetchWithTimeout(`${this.baseUrl}/embeddings`, {
      method: "POST",
      headers: this.buildAuthHeaders(),
      body: JSON.stringify({
        model: this.embeddingModel,
        input: texts,
      }),
    });

    handleRateLimitResponse(response, "openai");

    if (!response.ok) {
      const errorText = await response.text();
      try {
        const errorJson = JSON.parse(errorText) as unknown;
        const errorData = OpenAIErrorResponseSchema.parse(errorJson);
        throw new Error(
          `OpenAI Embedding API error: ${errorData.error.message} (${errorData.error.type})`
        );
      } catch (e) {
        if (
          e instanceof Error &&
          e.message.startsWith("OpenAI Embedding API error:")
        ) {
          throw e;
        }
        throw new Error(
          `OpenAI Embedding API error: ${response.status} ${response.statusText}`
        );
      }
    }

    const responseText = await response.text();
    const responseJson = JSON.parse(responseText) as unknown;
    const data = OpenAIEmbeddingResponseSchema.parse(responseJson);

    // Sort by index to maintain input order
    const sortedData = [...data.data].sort((a, b) => a.index - b.index);

    // Calculate approximate tokens per embedding (total / count)
    const tokensPerEmbedding = Math.ceil(
      data.usage.total_tokens / texts.length
    );

    return sortedData.map((item) => ({
      values: item.embedding,
      tokenCount: tokensPerEmbedding,
      model: data.model,
    }));
  }

  /**
   * Generate chat completion
   * @param prompt - Input prompt
   * @param config - Optional model configuration overrides
   * @returns Completion result with text, token count, model, and finish reason
   */
  async complete(
    prompt: string,
    config?: Partial<ModelConfig>
  ): Promise<CompletionResult> {
    const temperature = config?.temperature ?? 0.7;
    const maxTokens = config?.maxTokens ?? 4096;
    const model = config?.model ?? this.chatModel;

    const response = await this.fetchWithTimeout(
      `${this.baseUrl}/chat/completions`,
      {
        method: "POST",
        headers: this.buildAuthHeaders(),
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: prompt }],
          temperature,
          max_tokens: maxTokens,
        }),
      }
    );

    handleRateLimitResponse(response, "openai");

    if (!response.ok) {
      const errorText = await response.text();
      try {
        const errorJson = JSON.parse(errorText) as unknown;
        const errorData = OpenAIErrorResponseSchema.parse(errorJson);
        throw new Error(
          `OpenAI Chat API error: ${errorData.error.message} (${errorData.error.type})`
        );
      } catch (e) {
        if (
          e instanceof Error &&
          e.message.startsWith("OpenAI Chat API error:")
        ) {
          throw e;
        }
        throw new Error(
          `OpenAI Chat API error: ${response.status} ${response.statusText}`
        );
      }
    }

    const responseText = await response.text();
    const responseJson = JSON.parse(responseText) as unknown;
    const data = OpenAIChatResponseSchema.parse(responseJson);
    const choice = data.choices[0];

    if (!choice) {
      throw new Error("OpenAI returned empty choices array");
    }

    return {
      text: choice.message.content ?? "",
      tokenCount: data.usage.total_tokens,
      model: data.model,
      finishReason: this.mapFinishReason(choice.finish_reason),
    };
  }

  /**
   * Check if OpenAI API is available
   * @returns Availability status with optional error message
   */
  async checkAvailability(): Promise<{ available: boolean; error?: string }> {
    try {
      // Use models endpoint as a lightweight availability check
      const response = await this.fetchWithTimeout(`${this.baseUrl}/models`, {
        method: "GET",
        headers: this.buildAuthHeaders(),
      });

      handleRateLimitResponse(response, "openai");

      if (!response.ok) {
        const errorText = await response.text();
        try {
          const errorJson = JSON.parse(errorText) as unknown;
          const errorData = OpenAIErrorResponseSchema.parse(errorJson);
          return {
            available: false,
            error: `API error: ${errorData.error.message}`,
          };
        } catch {
          return {
            available: false,
            error: `API error: ${response.status} ${response.statusText}`,
          };
        }
      }

      return { available: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return { available: false, error: message };
    }
  }

  /**
   * Map OpenAI finish_reason to our FinishReason type
   * @param reason - OpenAI's finish_reason string
   * @returns Normalized FinishReason
   */
  private mapFinishReason(reason: string): FinishReason {
    switch (reason) {
      case "stop":
        return "stop";
      case "length":
        return "length";
      case "content_filter":
        return "content_filter";
      case "tool_calls":
      case "function_call":
        return "tool_use";
      default:
        return "unknown";
    }
  }
}
