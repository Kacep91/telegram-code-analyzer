import { z } from "zod";
import {
  BaseCompletionProvider,
  safeParseJSON,
  handleRateLimitResponse,
} from "./base.js";
import type { CompletionResult, ModelConfig, FinishReason } from "./types.js";

// =============================================================================
// Anthropic API Configuration
// =============================================================================

/** Anthropic API version header value */
const ANTHROPIC_API_VERSION = "2023-06-01";

/** Default timeout for API requests (60 seconds) */
const DEFAULT_TIMEOUT_MS = 60000;

/** Supported Anthropic models */
export const AnthropicModelSchema = z.enum([
  "claude-opus-4-5-20250514",
  "claude-sonnet-4-5-20250514",
]);
export type AnthropicModel = z.infer<typeof AnthropicModelSchema>;

// =============================================================================
// Anthropic API Response Types
// =============================================================================

/** Content block in Anthropic response */
interface AnthropicTextContent {
  readonly type: "text";
  readonly text: string;
}

/** Anthropic stop reasons */
type AnthropicStopReason =
  | "end_turn"
  | "max_tokens"
  | "stop_sequence"
  | "tool_use";

/** Token usage information */
interface AnthropicUsage {
  readonly input_tokens: number;
  readonly output_tokens: number;
}

/** Anthropic Messages API response */
interface AnthropicMessageResponse {
  readonly id: string;
  readonly type: "message";
  readonly role: "assistant";
  readonly content: readonly AnthropicTextContent[];
  readonly model: string;
  readonly stop_reason: AnthropicStopReason | null;
  readonly usage: AnthropicUsage;
}

/** Anthropic API error response */
interface AnthropicErrorResponse {
  readonly type: "error";
  readonly error: {
    readonly type: string;
    readonly message: string;
  };
}

// =============================================================================
// Anthropic Provider Implementation
// =============================================================================

/**
 * Anthropic LLM provider for Claude models
 * @remarks Completion-only provider - embeddings are not available through Anthropic API
 */
export class AnthropicProvider extends BaseCompletionProvider {
  readonly name = "anthropic" as const;

  private readonly chatModel: AnthropicModel;

  /**
   * Create Anthropic provider instance
   * @param apiKey - Anthropic API key
   * @param chatModel - Model to use for completions (default: claude-sonnet-4-5-20250514)
   * @param timeout - Request timeout in milliseconds (default: 60000)
   */
  constructor(
    apiKey: string,
    chatModel: AnthropicModel = "claude-sonnet-4-5-20250514",
    timeout: number = DEFAULT_TIMEOUT_MS
  ) {
    if (!apiKey || apiKey.trim().length === 0) {
      throw new Error("Anthropic API key is required");
    }

    super({
      apiKey,
      baseUrl: "https://api.anthropic.com/v1",
      timeout,
    });
    this.chatModel = chatModel;
  }

  /**
   * Build authorization headers for Anthropic API
   * @remarks Uses x-api-key header instead of Bearer token
   */
  protected override buildAuthHeaders(): Record<string, string> {
    return {
      "x-api-key": this.apiKey,
      "anthropic-version": ANTHROPIC_API_VERSION,
      "Content-Type": "application/json",
    };
  }

  /**
   * Map Anthropic stop_reason to unified FinishReason
   * @param stopReason - Anthropic stop reason
   * @returns Unified finish reason
   */
  private mapStopReason(stopReason: AnthropicStopReason | null): FinishReason {
    if (stopReason === null) {
      return "unknown";
    }

    switch (stopReason) {
      case "end_turn":
      case "stop_sequence":
        return "stop";
      case "max_tokens":
        return "length";
      case "tool_use":
        return "tool_use";
      default:
        return "unknown";
    }
  }

  /**
   * Extract text content from Anthropic response
   * @param content - Array of content blocks
   * @returns Concatenated text content
   */
  private extractTextContent(content: readonly AnthropicTextContent[]): string {
    return content
      .filter((block): block is AnthropicTextContent => block.type === "text")
      .map((block) => block.text)
      .join("");
  }

  /**
   * Generate text completion using Anthropic Messages API
   * @param prompt - Input prompt
   * @param config - Optional model configuration overrides
   * @returns Completion result with text, token count, and finish reason
   */
  async complete(
    prompt: string,
    config?: Partial<ModelConfig>
  ): Promise<CompletionResult> {
    const model = config?.model ?? this.chatModel;
    const maxTokens = config?.maxTokens ?? 4096;
    const temperature = config?.temperature ?? 0.7;

    const requestBody = {
      model,
      max_tokens: maxTokens,
      temperature,
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
    };

    const response = await this.fetchWithTimeout(`${this.baseUrl}/messages`, {
      method: "POST",
      headers: this.buildAuthHeaders(),
      body: JSON.stringify(requestBody),
    });

    handleRateLimitResponse(response, "anthropic");

    if (!response.ok) {
      const errorText = await response.text();
      const errorBody = safeParseJSON<AnthropicErrorResponse>(
        errorText,
        `Anthropic API error: ${response.status} ${response.statusText}`
      );
      const errorMessage =
        errorBody.error?.message ?? `HTTP ${response.status}`;
      throw new Error(`Anthropic API error: ${errorMessage}`);
    }

    const responseText = await response.text();
    const data = safeParseJSON<AnthropicMessageResponse>(
      responseText,
      "Anthropic returned invalid JSON response"
    );

    return {
      text: this.extractTextContent(data.content),
      tokenCount: data.usage.input_tokens + data.usage.output_tokens,
      model: data.model,
      finishReason: this.mapStopReason(data.stop_reason),
    };
  }

  /**
   * Check if Anthropic API is available and properly configured
   * @returns Availability status with optional error message
   */
  async checkAvailability(): Promise<{ available: boolean; error?: string }> {
    try {
      // Use a minimal request to check API availability
      // Anthropic doesn't have a dedicated health endpoint, so we make a minimal completion request
      const response = await this.fetchWithTimeout(`${this.baseUrl}/messages`, {
        method: "POST",
        headers: this.buildAuthHeaders(),
        body: JSON.stringify({
          model: this.chatModel,
          max_tokens: 1,
          messages: [{ role: "user", content: "hi" }],
        }),
      });

      handleRateLimitResponse(response, "anthropic");

      if (response.ok) {
        return { available: true };
      }

      const errorText = await response.text();
      try {
        const errorBody = safeParseJSON<AnthropicErrorResponse>(errorText);
        return {
          available: false,
          error: errorBody.error?.message ?? `HTTP ${response.status}`,
        };
      } catch {
        return {
          available: false,
          error: `HTTP ${response.status} ${response.statusText}`,
        };
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      return {
        available: false,
        error: errorMessage,
      };
    }
  }
}
