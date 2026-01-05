import { z } from "zod";
import type { LLMEmbeddingProvider, EmbeddingResult } from "./types.js";
import { LLMError, LLMErrorSubType } from "../errors/index.js";

// =============================================================================
// Jina AI Embedding Provider
// =============================================================================

const JINA_BASE_URL = "https://api.jina.ai/v1";
const DEFAULT_MODEL = "jina-embeddings-v3";
const DEFAULT_TIMEOUT = 60000;

/**
 * Schema for Jina embedding response
 */
const JinaEmbeddingResponseSchema = z.object({
  data: z.array(
    z.object({
      embedding: z.array(z.number()),
      index: z.number(),
    })
  ),
  usage: z
    .object({
      total_tokens: z.number(),
    })
    .optional(),
});

/**
 * Schema for Jina provider configuration
 */
export const JinaProviderConfigSchema = z.object({
  apiKey: z.string().min(1),
  model: z.string().min(1).default(DEFAULT_MODEL),
  timeout: z.number().min(1000).max(300000).default(DEFAULT_TIMEOUT),
});

export type JinaProviderConfig = z.output<typeof JinaProviderConfigSchema>;
export type JinaProviderConfigInput = z.input<typeof JinaProviderConfigSchema>;

/**
 * Jina AI Embedding Provider
 *
 * @remarks
 * Provides high-quality embeddings optimized for retrieval.
 * Supports multilingual text and code.
 *
 * Models:
 * - jina-embeddings-v3 (1024 dims, multilingual)
 * - jina-embeddings-v2-base-en (768 dims, English)
 * - jina-embeddings-v2-base-code (768 dims, code-optimized)
 */
export class JinaEmbeddingProvider implements LLMEmbeddingProvider {
  readonly name = "jina" as const;

  private readonly apiKey: string;
  private readonly model: string;
  private readonly timeout: number;

  constructor(config: JinaProviderConfigInput) {
    const validated = JinaProviderConfigSchema.parse(config);
    this.apiKey = validated.apiKey;
    this.model = validated.model;
    this.timeout = validated.timeout;
  }

  /**
   * Generate embedding for a single text
   */
  async embed(text: string): Promise<EmbeddingResult> {
    const results = await this.embedBatch([text]);
    const result = results[0];
    if (!result) {
      throw new LLMError(
        "Empty embedding result from Jina API",
        LLMErrorSubType.INVALID_RESPONSE,
        "jina"
      );
    }
    return result;
  }

  /**
   * Generate embeddings for multiple texts
   */
  async embedBatch(
    texts: readonly string[]
  ): Promise<readonly EmbeddingResult[]> {
    if (texts.length === 0) return [];

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(`${JINA_BASE_URL}/embeddings`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          input: texts,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new LLMError(
          `Jina API error: ${response.status} - ${errorText.slice(0, 200)}`,
          response.status === 401
            ? LLMErrorSubType.AUTH_FAILED
            : response.status === 429
              ? LLMErrorSubType.RATE_LIMIT
              : LLMErrorSubType.API_ERROR,
          "jina"
        );
      }

      const data: unknown = await response.json();
      const parsed = JinaEmbeddingResponseSchema.parse(data);

      // Sort by index to maintain order
      const sorted = [...parsed.data].sort((a, b) => a.index - b.index);

      return sorted.map((item, idx) => ({
        values: item.embedding,
        tokenCount: Math.ceil((texts[idx]?.length ?? 0) / 4),
        model: this.model,
      }));
    } catch (error) {
      if (error instanceof LLMError) throw error;

      if (error instanceof Error && error.name === "AbortError") {
        throw new LLMError(
          `Jina API timeout after ${this.timeout}ms`,
          LLMErrorSubType.TIMEOUT,
          "jina"
        );
      }

      throw new LLMError(
        `Jina API error: ${error instanceof Error ? error.message : "Unknown error"}`,
        LLMErrorSubType.API_ERROR,
        "jina"
      );
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Check if Jina API is available
   */
  async checkAvailability(): Promise<{ available: boolean; error?: string }> {
    try {
      const result = await this.embed("test");
      return { available: result.values.length > 0 };
    } catch (error) {
      return {
        available: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }
}
