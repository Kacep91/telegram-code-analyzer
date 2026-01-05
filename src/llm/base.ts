import { z } from "zod";
import { LLMError, LLMErrorSubType } from "../errors/index.js";
import type {
  LLMCompletionProvider,
  LLMEmbeddingProvider,
  LLMProviderType,
  EmbeddingResult,
  CompletionResult,
  ModelConfig,
} from "./types.js";

// =============================================================================
// JSON Parsing Utilities
// =============================================================================

/**
 * Safely parse JSON string with fallback error message
 * @param text - Raw text to parse as JSON
 * @param fallbackMessage - Message to use if parsing fails (defaults to raw text)
 * @returns Parsed JSON object
 * @throws Error with fallback message if parsing fails
 */
export function safeParseJSON<T>(text: string, fallbackMessage?: string): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(
      fallbackMessage ?? `Invalid JSON response: ${text.slice(0, 200)}`
    );
  }
}

/**
 * Handle rate limit (429) response and extract retry-after header
 * @param response - Fetch Response object
 * @param providerName - Name of the LLM provider for error context
 * @throws LLMError with RATE_LIMIT subtype if response status is 429
 */
export function handleRateLimitResponse(
  response: Response,
  providerName: string
): void {
  if (response.status === 429) {
    const retryAfterHeader = response.headers.get("retry-after");
    let retryAfterSeconds: number | null = null;

    if (retryAfterHeader) {
      const parsed = parseInt(retryAfterHeader, 10);
      if (!isNaN(parsed)) {
        retryAfterSeconds = parsed;
      }
    }

    throw new LLMError(
      `Rate limit exceeded. Retry after ${retryAfterSeconds ?? "unknown"} seconds`,
      LLMErrorSubType.RATE_LIMIT,
      providerName,
      { retryAfterSeconds }
    );
  }
}

// =============================================================================
// Base Provider Configuration
// =============================================================================

/**
 * Schema for base provider configuration
 * @remarks Validates API key format and timeout constraints
 */
export const BaseProviderConfigSchema = z.object({
  /** API key for authentication */
  apiKey: z.string().min(1),
  /** Base URL for API requests */
  baseUrl: z.string().url(),
  /** Request timeout in milliseconds (1s - 5min) */
  timeout: z.number().min(1000).max(300000).default(30000),
});
export type BaseProviderConfig = z.infer<typeof BaseProviderConfigSchema>;

// =============================================================================
// Abstract Base Providers
// =============================================================================

/**
 * Abstract base class for completion-only LLM providers
 * @remarks Use this for providers that don't support embeddings (Anthropic, Perplexity)
 */
export abstract class BaseCompletionProvider implements LLMCompletionProvider {
  abstract readonly name: LLMProviderType;

  protected readonly apiKey: string;
  protected readonly baseUrl: string;
  protected readonly timeout: number;

  constructor(config: BaseProviderConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl;
    this.timeout = config.timeout;
  }

  /**
   * Fetch with timeout support
   * @param url - Request URL
   * @param options - Fetch options
   * @returns Response object
   * @throws Error on timeout or network failure
   */
  protected async fetchWithTimeout(
    url: string,
    options: RequestInit
  ): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });
      return response;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Build authorization headers for API requests
   */
  protected buildAuthHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
    };
  }

  abstract complete(
    prompt: string,
    config?: Partial<ModelConfig>
  ): Promise<CompletionResult>;
  abstract checkAvailability(): Promise<{ available: boolean; error?: string }>;
}

/**
 * Abstract base class for full LLM providers with embedding support
 * @remarks Use this for providers that support both completion and embeddings (OpenAI, Gemini)
 */
export abstract class BaseFullProvider
  extends BaseCompletionProvider
  implements LLMEmbeddingProvider
{
  abstract embed(text: string): Promise<EmbeddingResult>;
  abstract embedBatch(
    texts: readonly string[]
  ): Promise<readonly EmbeddingResult[]>;
}
