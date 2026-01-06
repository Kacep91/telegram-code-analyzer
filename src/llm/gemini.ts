import { z } from "zod";
import {
  BaseFullProvider,
  BaseProviderConfigSchema,
  handleRateLimitResponse,
} from "./base.js";
import type {
  EmbeddingResult,
  CompletionResult,
  ModelConfig,
  FinishReason,
} from "./types.js";

// =============================================================================
// Gemini API Response Schemas
// =============================================================================

/**
 * Schema for Gemini embedding response
 * @see https://ai.google.dev/api/embeddings#method:-models.embedcontent
 */
const GeminiEmbeddingResponseSchema = z.object({
  embedding: z.object({
    values: z.array(z.number()),
  }),
});

/**
 * Schema for Gemini content generation response
 * @see https://ai.google.dev/api/generate-content#response
 */
const GeminiGenerateResponseSchema = z.object({
  candidates: z
    .array(
      z.object({
        content: z.object({
          parts: z.array(
            z.object({
              text: z.string(),
            })
          ),
        }),
        finishReason: z.enum([
          "STOP",
          "MAX_TOKENS",
          "SAFETY",
          "RECITATION",
          "OTHER",
          "FINISH_REASON_UNSPECIFIED",
        ]),
      })
    )
    .min(1),
  usageMetadata: z
    .object({
      promptTokenCount: z.number().optional(),
      candidatesTokenCount: z.number().optional(),
      totalTokenCount: z.number().optional(),
    })
    .optional(),
});

type GeminiGenerateResponse = z.infer<typeof GeminiGenerateResponseSchema>;

// =============================================================================
// Gemini Provider Configuration
// =============================================================================

/** Gemini API base URL */
const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

/** Default timeout for Gemini requests (60 seconds) */
const GEMINI_DEFAULT_TIMEOUT = 60000;

/** Default embedding model (gemini-embedding-001 is newest, 768-3072 dims) */
const DEFAULT_EMBEDDING_MODEL = "gemini-embedding-001";

/** Default chat model */
const DEFAULT_CHAT_MODEL = "gemini-2.0-flash";

/**
 * Schema for Gemini provider configuration
 */
export const GeminiProviderConfigSchema = z.object({
  apiKey: z.string().min(1),
  embeddingModel: z.string().min(1).default(DEFAULT_EMBEDDING_MODEL),
  chatModel: z.string().min(1).default(DEFAULT_CHAT_MODEL),
  timeout: z.number().min(1000).max(300000).default(GEMINI_DEFAULT_TIMEOUT),
});
/** Output type after Zod parsing (all fields present) */
export type GeminiProviderConfig = z.output<typeof GeminiProviderConfigSchema>;
/** Input type for constructor (optional fields with defaults) */
export type GeminiProviderConfigInput = z.input<
  typeof GeminiProviderConfigSchema
>;

// =============================================================================
// Finish Reason Mapping
// =============================================================================

/**
 * Maps Gemini finish reason to our FinishReason type
 * @param geminiReason - Gemini API finish reason
 * @returns Normalized finish reason
 */
function mapGeminiFinishReason(
  geminiReason: GeminiGenerateResponse["candidates"][0]["finishReason"]
): FinishReason {
  switch (geminiReason) {
    case "STOP":
      return "stop";
    case "MAX_TOKENS":
      return "length";
    case "SAFETY":
    case "RECITATION":
      return "content_filter";
    case "OTHER":
    case "FINISH_REASON_UNSPECIFIED":
    default:
      return "unknown";
  }
}

// =============================================================================
// Gemini Provider Implementation
// =============================================================================

/**
 * Google Gemini LLM Provider
 *
 * @remarks
 * Full provider with both completion and embedding capabilities.
 * Uses Authorization Bearer header for authentication.
 *
 * Supported models:
 * - Completions: gemini-2.5-pro, gemini-2.0-flash
 * - Embeddings: text-embedding-004, gemini-embedding-001
 *
 * @example
 * ```typescript
 * const gemini = new GeminiProvider({ apiKey: "your-api-key" });
 * const result = await gemini.complete("Hello, world!");
 * const embedding = await gemini.embed("Sample text");
 * ```
 */
export class GeminiProvider extends BaseFullProvider {
  readonly name = "gemini" as const;

  private readonly embeddingModel: string;
  private readonly chatModel: string;

  /**
   * Creates a new Gemini provider instance
   * @param config - Provider configuration with API key and optional model overrides
   */
  constructor(config: GeminiProviderConfigInput) {
    const validatedConfig = GeminiProviderConfigSchema.parse(config);

    const baseConfig = BaseProviderConfigSchema.parse({
      apiKey: validatedConfig.apiKey,
      baseUrl: GEMINI_BASE_URL,
      timeout: validatedConfig.timeout,
    });

    super(baseConfig);

    this.embeddingModel = validatedConfig.embeddingModel;
    this.chatModel = validatedConfig.chatModel;
  }

  /**
   * Builds URL for Gemini API endpoint with API key as query parameter
   * @param endpoint - API endpoint path
   * @returns Full URL with API key
   */
  private buildUrl(endpoint: string): string {
    return `${this.baseUrl}${endpoint}?key=${this.apiKey}`;
  }

  /**
   * Build headers for Gemini API (no auth header needed - key in URL)
   * @returns Headers with Content-Type only
   */
  protected override buildAuthHeaders(): Record<string, string> {
    return {
      "Content-Type": "application/json",
    };
  }

  /**
   * Generate embedding for a single text
   * @param text - Input text to embed
   * @returns Embedding result with values and metadata
   * @throws Error on API failure or validation error
   */
  async embed(text: string): Promise<EmbeddingResult> {
    const url = this.buildUrl(`/models/${this.embeddingModel}:embedContent`);

    const response = await this.fetchWithTimeout(url, {
      method: "POST",
      headers: this.buildAuthHeaders(),
      body: JSON.stringify({
        model: `models/${this.embeddingModel}`,
        content: {
          parts: [{ text }],
        },
      }),
    });

    handleRateLimitResponse(response, "gemini");

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Gemini embedding API error: ${response.status} - ${errorText.slice(0, 200)}`
      );
    }

    const data: unknown = await response.json();
    const parsed = GeminiEmbeddingResponseSchema.parse(data);

    return {
      values: parsed.embedding.values,
      tokenCount: Math.ceil(text.length / 4), // Approximate token count
      model: this.embeddingModel,
    };
  }

  /**
   * Generate embeddings for multiple texts with parallel processing
   * @param texts - Array of texts to embed
   * @returns Array of embedding results in original order
   * @remarks Processes in batches of 10 to limit concurrency and avoid rate limits
   */
  async embedBatch(
    texts: readonly string[]
  ): Promise<readonly EmbeddingResult[]> {
    if (texts.length === 0) return [];

    const BATCH_SIZE = 10;
    const results: EmbeddingResult[] = [];

    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
      const batch = texts.slice(i, i + BATCH_SIZE);
      const batchResults = await Promise.all(
        batch.map((text) => this.embed(text))
      );
      results.push(...batchResults);
    }

    return results;
  }

  /**
   * Generate text completion
   * @param prompt - Input prompt
   * @param config - Optional model configuration overrides
   * @returns Completion result with text and metadata
   * @throws Error on API failure or validation error
   */
  async complete(
    prompt: string,
    config?: Partial<ModelConfig>
  ): Promise<CompletionResult> {
    const model = config?.model ?? this.chatModel;
    const temperature = config?.temperature ?? 0.7;
    const maxTokens = config?.maxTokens ?? 4096;

    const url = this.buildUrl(`/models/${model}:generateContent`);

    const response = await this.fetchWithTimeout(url, {
      method: "POST",
      headers: this.buildAuthHeaders(),
      body: JSON.stringify({
        contents: [
          {
            parts: [{ text: prompt }],
          },
        ],
        generationConfig: {
          temperature,
          maxOutputTokens: maxTokens,
        },
      }),
    });

    handleRateLimitResponse(response, "gemini");

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Gemini completion API error: ${response.status} - ${errorText.slice(0, 200)}`
      );
    }

    const data: unknown = await response.json();
    const parsed = GeminiGenerateResponseSchema.parse(data);

    const candidate = parsed.candidates[0];
    if (!candidate) {
      throw new Error("Gemini API returned empty candidates array");
    }

    const text = candidate.content.parts.map((p) => p.text).join("");
    const finishReason = mapGeminiFinishReason(candidate.finishReason);
    const tokenCount = parsed.usageMetadata?.totalTokenCount ?? 0;

    return {
      text,
      tokenCount,
      model,
      finishReason,
    };
  }

  /**
   * Check if Gemini API is available and properly configured
   * @returns Availability status with optional error message
   */
  async checkAvailability(): Promise<{ available: boolean; error?: string }> {
    try {
      // Use a simple list models request to check connectivity
      const url = this.buildUrl("/models");

      const response = await this.fetchWithTimeout(url, {
        method: "GET",
        headers: this.buildAuthHeaders(),
      });

      handleRateLimitResponse(response, "gemini");

      if (!response.ok) {
        const errorText = await response.text();
        return {
          available: false,
          error: `Gemini API error: ${response.status} - ${errorText.slice(0, 200)}`,
        };
      }

      return { available: true };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      return {
        available: false,
        error: `Gemini connection failed: ${errorMessage}`,
      };
    }
  }
}
