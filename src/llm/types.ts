import { z } from "zod";

// =============================================================================
// Provider Types
// =============================================================================

export const LLMProviderTypeSchema = z.enum([
  "openai",
  "gemini",
  "anthropic",
  "perplexity",
  "jina",
  "claude-code",
  "codex",
]);
export type LLMProviderType = z.infer<typeof LLMProviderTypeSchema>;

/** CLI-based provider types (not API-based) */
export const CLI_PROVIDER_TYPES = ["claude-code", "codex"] as const;
export type CLIProviderType = (typeof CLI_PROVIDER_TYPES)[number];

/** Check if provider type is a CLI tool (not API-based) */
export function isCLIProvider(type: LLMProviderType): type is CLIProviderType {
  return CLI_PROVIDER_TYPES.includes(type as CLIProviderType);
}

// =============================================================================
// Model Configuration
// =============================================================================

export const ModelConfigSchema = z.object({
  provider: LLMProviderTypeSchema,
  model: z.string().min(1),
  temperature: z.number().min(0).max(2).default(0.7),
  maxTokens: z.number().positive().default(4096),
});
export type ModelConfig = z.infer<typeof ModelConfigSchema>;

// =============================================================================
// Result Types
// =============================================================================

/** Result of embedding operation */
export interface EmbeddingResult {
  readonly values: readonly number[];
  readonly tokenCount: number;
  readonly model: string;
}

/**
 * Reason why completion finished
 * @remarks Extended to cover all common API responses
 */
export const FinishReasonSchema = z.enum([
  "stop",
  "length",
  "content_filter",
  "tool_use",
  "error",
  "unknown",
]);
export type FinishReason = z.infer<typeof FinishReasonSchema>;

/** Result of completion operation */
export interface CompletionResult {
  readonly text: string;
  readonly tokenCount: number;
  readonly model: string;
  readonly finishReason: FinishReason;
}

// =============================================================================
// Provider Interfaces (Separated for flexibility)
// =============================================================================

/**
 * Base provider with completion capability only
 * @remarks Use this for providers that don't support embeddings (e.g., Claude Code CLI)
 */
export interface LLMCompletionProvider {
  readonly name: LLMProviderType;

  /**
   * Generate text completion
   * @param prompt - Input prompt
   * @param config - Optional model configuration overrides
   */
  complete(
    prompt: string,
    config?: Partial<ModelConfig>
  ): Promise<CompletionResult>;

  /**
   * Check if provider is available and properly configured
   */
  checkAvailability(): Promise<{ available: boolean; error?: string }>;
}

/**
 * Provider with embedding capabilities
 * @remarks Use this for vector search and RAG pipelines
 */
export interface LLMEmbeddingProvider {
  /**
   * Generate embedding for a single text
   * @param text - Input text to embed
   */
  embed(text: string): Promise<EmbeddingResult>;

  /**
   * Generate embeddings for multiple texts
   * @param texts - Array of texts to embed
   */
  embedBatch(texts: readonly string[]): Promise<readonly EmbeddingResult[]>;
}

/**
 * Full provider with both completion and embedding capabilities
 * @remarks Most API providers (OpenAI, Gemini) implement this
 */
export type LLMFullProvider = LLMCompletionProvider & LLMEmbeddingProvider;

/**
 * Main provider type (backward compatible)
 * @remarks Alias for LLMCompletionProvider - use LLMFullProvider when embeddings needed
 */
export type LLMProvider = LLMCompletionProvider;

// =============================================================================
// Factory Configuration
// =============================================================================

/**
 * Schema for provider factory configuration
 * @remarks Validates that at least one API key is provided
 */
export const ProviderFactoryConfigSchema = z
  .object({
    openaiApiKey: z.string().min(1).optional(),
    geminiApiKey: z.string().min(1).optional(),
    anthropicApiKey: z.string().min(1).optional(),
    perplexityApiKey: z.string().min(1).optional(),
    jinaApiKey: z.string().min(1).optional(),
  })
  .refine((data) => Object.values(data).some((v) => v !== undefined), {
    message: "At least one API key must be provided",
  });
export type ProviderFactoryConfig = z.infer<typeof ProviderFactoryConfigSchema>;
