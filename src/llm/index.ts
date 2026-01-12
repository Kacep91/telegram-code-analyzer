/**
 * LLM Provider Factory and Registry
 * @module src/llm/index
 */

// =============================================================================
// Re-exports
// =============================================================================

export * from "./types.js";
export {
  BaseCompletionProvider,
  BaseFullProvider,
  BaseProviderConfigSchema,
  safeParseJSON,
  handleRateLimitResponse,
} from "./base.js";
export type { BaseProviderConfig } from "./base.js";
export { OpenAIProvider } from "./openai.js";
export { GeminiProvider, GeminiProviderConfigSchema } from "./gemini.js";
export type {
  GeminiProviderConfig,
  GeminiProviderConfigInput,
} from "./gemini.js";
export { AnthropicProvider, AnthropicModelSchema } from "./anthropic.js";
export type { AnthropicModel } from "./anthropic.js";
export { PerplexityProvider, PerplexityModelSchema } from "./perplexity.js";
export type { PerplexityModel } from "./perplexity.js";
export { JinaEmbeddingProvider, JinaProviderConfigSchema } from "./jina.js";
export type { JinaProviderConfig, JinaProviderConfigInput } from "./jina.js";
export {
  CLICompletionAdapter,
  createCLICompletionAdapter,
  checkCLIAvailability,
} from "./cli-adapter.js";
export type { CLIAdapterConfig } from "./cli-adapter.js";
export { retryWithBackoff, isRetryableError } from "./retry.js";
export type { RetryOptions } from "./retry.js";
export {
  CompletionProviderWithFallback,
  createFallbackProvider,
} from "./fallback.js";
export { withTimeout, DEFAULT_TIMEOUTS } from "./timeout.js";
export type { TimeoutOptions, TimeoutType } from "./timeout.js";

import type {
  LLMProviderType,
  LLMCompletionProvider,
  LLMEmbeddingProvider,
  LLMFullProvider,
  ProviderFactoryConfig,
} from "./types.js";
import { ProviderFactoryConfigSchema, isCLIProvider } from "./types.js";
import { OpenAIProvider } from "./openai.js";
import { GeminiProvider } from "./gemini.js";
import { AnthropicProvider } from "./anthropic.js";
import { PerplexityProvider } from "./perplexity.js";
import { JinaEmbeddingProvider } from "./jina.js";
import { createCLICompletionAdapter } from "./cli-adapter.js";

// =============================================================================
// Provider Models Registry
// =============================================================================

/**
 * Available models for each provider
 * @remarks Registry of supported models per provider with default selections
 */
export const PROVIDER_MODELS = {
  openai: {
    chat: ["gpt-4.1", "gpt-4.1-mini"],
    embedding: ["text-embedding-3-large", "text-embedding-3-small"],
    default: { chat: "gpt-4.1-mini", embedding: "text-embedding-3-large" },
  },
  gemini: {
    chat: ["gemini-2.5-pro", "gemini-2.0-flash"],
    embedding: ["gemini-embedding-001", "text-embedding-004"],
    default: { chat: "gemini-2.0-flash", embedding: "gemini-embedding-001" },
  },
  anthropic: {
    chat: ["claude-opus-4-5-20250514", "claude-sonnet-4-5-20250514"],
    embedding: [], // Anthropic doesn't support embeddings
    default: { chat: "claude-sonnet-4-5-20250514" },
  },
  perplexity: {
    chat: ["sonar-pro", "sonar"],
    embedding: [], // Perplexity doesn't support embeddings
    default: { chat: "sonar-pro" },
  },
  jina: {
    chat: [], // Jina doesn't support chat
    embedding: ["jina-embeddings-v3", "jina-embeddings-v2-base-code"],
    default: { embedding: "jina-embeddings-v3" },
  },
} as const;

/** Provider types that support embeddings */
export type EmbeddingProviderType = "openai" | "gemini" | "jina";

/** Provider types that only support completions */
export type CompletionOnlyProviderType = "anthropic" | "perplexity";

// =============================================================================
// Type Guards
// =============================================================================

/**
 * Check if a provider type supports embeddings
 * @param type - Provider type to check
 * @returns True if provider supports embeddings
 */
export function supportsEmbeddings(
  type: LLMProviderType
): type is EmbeddingProviderType {
  return type === "openai" || type === "gemini" || type === "jina";
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create a completion provider by type
 * @param type - Provider type (openai, gemini, anthropic, perplexity)
 * @param apiKey - API key for the provider
 * @returns Completion provider instance
 * @throws Error if provider type is unknown or claude-code
 *
 * @example
 * ```typescript
 * const provider = createCompletionProvider("openai", "sk-...");
 * const result = await provider.complete("Hello!");
 * ```
 */
export function createCompletionProvider(
  type: LLMProviderType,
  apiKey: string
): LLMCompletionProvider {
  switch (type) {
    case "openai":
      return new OpenAIProvider(apiKey);
    case "gemini":
      return new GeminiProvider({ apiKey });
    case "anthropic":
      return new AnthropicProvider(apiKey);
    case "perplexity":
      return new PerplexityProvider({ apiKey });
    case "claude-code":
    case "codex":
      throw new Error(
        `${type} is a CLI provider and must be created via createCLICompletionAdapter, not through factory`
      );
    case "jina":
      throw new Error(
        "Jina does not support completions. Use embed() instead."
      );
    default: {
      const exhaustiveCheck: never = type;
      throw new Error(`Unknown LLM provider type: ${exhaustiveCheck}`);
    }
  }
}

/**
 * Create an embedding provider
 * @param type - Provider type (must support embeddings: openai or gemini)
 * @param apiKey - API key for the provider
 * @returns Embedding provider instance
 * @throws Error if provider doesn't support embeddings
 *
 * @example
 * ```typescript
 * const provider = createEmbeddingProvider("openai", "sk-...");
 * const embedding = await provider.embed("Sample text");
 * ```
 */
export function createEmbeddingProvider(
  type: LLMProviderType,
  apiKey: string
): LLMEmbeddingProvider {
  if (type === "anthropic" || type === "perplexity" || isCLIProvider(type)) {
    throw new Error(
      `${type} does not support embeddings. Use OpenAI, Gemini, or Jina instead.`
    );
  }

  switch (type) {
    case "openai":
      return new OpenAIProvider(apiKey);
    case "gemini":
      return new GeminiProvider({ apiKey });
    case "jina":
      return new JinaEmbeddingProvider({ apiKey });
    default: {
      // TypeScript narrows type after if-check, so this shouldn't be reachable
      const exhaustiveCheck: never = type;
      throw new Error(`Unknown embedding provider type: ${exhaustiveCheck}`);
    }
  }
}

/**
 * Create a full provider (completion + embedding)
 * @param type - Provider type (must support both: openai or gemini)
 * @param apiKey - API key
 * @returns Full provider instance with both capabilities
 * @throws Error if provider doesn't support embeddings
 *
 * @example
 * ```typescript
 * const provider = createFullProvider("gemini", "AIza...");
 * const completion = await provider.complete("Hello!");
 * const embedding = await provider.embed("Sample text");
 * ```
 */
export function createFullProvider(
  type: LLMProviderType,
  apiKey: string
): LLMFullProvider {
  if (type === "anthropic" || type === "perplexity" || isCLIProvider(type)) {
    throw new Error(
      `${type} does not support embeddings. Use OpenAI or Gemini for full provider.`
    );
  }

  switch (type) {
    case "openai":
      return new OpenAIProvider(apiKey);
    case "gemini":
      return new GeminiProvider({ apiKey });
    case "jina":
      throw new Error(
        "Jina only supports embeddings. Use createEmbeddingProvider instead."
      );
    default: {
      // TypeScript narrows type after if-check, so this shouldn't be reachable
      const exhaustiveCheck: never = type;
      throw new Error(`Unknown full provider type: ${exhaustiveCheck}`);
    }
  }
}

/**
 * Get embedding provider from config, with fallback to OpenAI
 * @param config - Factory configuration with API keys
 * @param preferredType - Optional preferred provider type
 * @returns Embedding provider instance
 * @throws Error if no embedding provider is available
 *
 * @remarks
 * Useful because Anthropic/Perplexity don't have embeddings.
 * Falls back to OpenAI first, then Gemini if preferred type unavailable.
 *
 * @example
 * ```typescript
 * const provider = getEmbeddingProvider({
 *   openaiApiKey: "sk-...",
 *   geminiApiKey: "AIza..."
 * }, "gemini");
 * ```
 */
export function getEmbeddingProvider(
  config: ProviderFactoryConfig,
  preferredType?: LLMProviderType
): LLMEmbeddingProvider {
  const validated = ProviderFactoryConfigSchema.parse(config);

  // If preferred type supports embeddings and has key, use it
  if (preferredType === "openai" && validated.openaiApiKey) {
    return new OpenAIProvider(validated.openaiApiKey);
  }
  if (preferredType === "gemini" && validated.geminiApiKey) {
    return new GeminiProvider({ apiKey: validated.geminiApiKey });
  }
  if (preferredType === "jina" && validated.jinaApiKey) {
    return new JinaEmbeddingProvider({ apiKey: validated.jinaApiKey });
  }

  // Fallback order: Jina (best for code) -> OpenAI -> Gemini
  if (validated.jinaApiKey) {
    return new JinaEmbeddingProvider({ apiKey: validated.jinaApiKey });
  }
  if (validated.openaiApiKey) {
    return new OpenAIProvider(validated.openaiApiKey);
  }
  if (validated.geminiApiKey) {
    return new GeminiProvider({ apiKey: validated.geminiApiKey });
  }

  throw new Error(
    "No embedding provider available. Configure JINA_API_KEY, OPENAI_API_KEY, or GEMINI_API_KEY."
  );
}

/**
 * Check which providers are available based on config
 * @param config - Factory configuration with API keys
 * @returns Array of available provider types
 *
 * @example
 * ```typescript
 * const available = getAvailableProviders({ openaiApiKey: "sk-..." });
 * // Returns: ["openai"]
 * ```
 */
export function getAvailableProviders(
  config: ProviderFactoryConfig
): LLMProviderType[] {
  const available: LLMProviderType[] = [];

  if (config.openaiApiKey) available.push("openai");
  if (config.geminiApiKey) available.push("gemini");
  if (config.anthropicApiKey) available.push("anthropic");
  if (config.perplexityApiKey) available.push("perplexity");
  if (config.jinaApiKey) available.push("jina");

  return available;
}

/**
 * Check provider availability via API call
 * @param type - Provider type to check
 * @param apiKey - API key for the provider
 * @returns Availability status with optional error message
 *
 * @example
 * ```typescript
 * const status = await checkProviderAvailability("openai", "sk-...");
 * if (!status.available) {
 *   console.error("Provider unavailable:", status.error);
 * }
 * ```
 */
export async function checkProviderAvailability(
  type: LLMProviderType,
  apiKey: string
): Promise<{ available: boolean; error?: string }> {
  if (isCLIProvider(type)) {
    return {
      available: false,
      error: `${type} is a CLI provider - use checkCLIAvailability instead`,
    };
  }

  try {
    const provider = createCompletionProvider(type, apiKey);
    return await provider.checkAvailability();
  } catch (error) {
    return {
      available: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

// =============================================================================
// Completion Provider with CLI Fallback
// =============================================================================

/**
 * Configuration for completion provider with fallback
 */
export interface CompletionProviderFallbackConfig {
  /** API keys for LLM providers */
  readonly apiKeys?: ProviderFactoryConfig;
  /** Preferred provider type (excludes jina which is embedding-only) */
  readonly preferredProvider?: Exclude<LLMProviderType, "jina">;
  /** Project path for CLI fallback (defaults to cwd) */
  readonly projectPath?: string;
  /** Timeout for CLI operations in milliseconds */
  readonly cliTimeout?: number;
}

/**
 * Result of getting completion provider with fallback
 */
export interface CompletionProviderResult {
  /** The completion provider instance */
  readonly provider: LLMCompletionProvider;
  /** Type of provider returned */
  readonly providerType: LLMProviderType;
  /** Whether CLI fallback was used */
  readonly isCLIFallback: boolean;
}

/**
 * Get a completion provider with CLI fallback
 *
 * This function tries to create an API-based completion provider first,
 * and falls back to CLI tools (Claude Code CLI or Codex CLI) if no API keys
 * are available.
 *
 * @param config - Configuration for provider selection
 * @returns Completion provider result with provider instance and metadata
 * @throws Error if no provider is available (neither API nor CLI)
 *
 * @remarks
 * Priority order for API providers:
 * 1. Preferred provider (if specified and API key available)
 * 2. OpenAI
 * 3. Gemini
 * 4. Anthropic
 * 5. Perplexity
 *
 * CLI fallback order:
 * 1. Claude Code CLI (preferred)
 * 2. Codex CLI
 *
 * @example
 * ```typescript
 * // With API keys
 * const result = await getCompletionProviderWithFallback({
 *   apiKeys: { openaiApiKey: "sk-..." }
 * });
 *
 * // Without API keys (will use CLI if available)
 * const result = await getCompletionProviderWithFallback({});
 *
 * console.log(`Using provider: ${result.providerType}`);
 * console.log(`Is CLI fallback: ${result.isCLIFallback}`);
 *
 * const response = await result.provider.complete("Hello!");
 * ```
 */
export async function getCompletionProviderWithFallback(
  config: CompletionProviderFallbackConfig = {}
): Promise<CompletionProviderResult> {
  const { apiKeys, preferredProvider, projectPath, cliTimeout } = config;

  // Try preferred provider first if specified (skip CLI providers - they don't use API keys)
  if (preferredProvider && !isCLIProvider(preferredProvider) && apiKeys) {
    const apiKey = getApiKeyForProvider(preferredProvider, apiKeys);
    if (apiKey) {
      try {
        const provider = createCompletionProvider(preferredProvider, apiKey);
        return {
          provider,
          providerType: preferredProvider,
          isCLIFallback: false,
        };
      } catch {
        // Fall through to other providers
      }
    }
  }

  // Try API providers in priority order
  if (apiKeys) {
    const providerOrder: Array<
      Exclude<LLMProviderType, "jina" | "claude-code" | "codex">
    > = ["openai", "gemini", "anthropic", "perplexity"];

    for (const providerType of providerOrder) {
      const apiKey = getApiKeyForProvider(providerType, apiKeys);
      if (apiKey) {
        try {
          const provider = createCompletionProvider(providerType, apiKey);
          return {
            provider,
            providerType,
            isCLIFallback: false,
          };
        } catch {
          // Try next provider
        }
      }
    }
  }

  // Fallback to CLI
  const cliAdapter = await createCLICompletionAdapter(projectPath, cliTimeout);
  if (cliAdapter) {
    return {
      provider: cliAdapter,
      providerType: "claude-code",
      isCLIFallback: true,
    };
  }

  throw new Error(
    "No completion provider available. Configure API keys (OPENAI_API_KEY, GEMINI_API_KEY, ANTHROPIC_API_KEY, or PERPLEXITY_API_KEY) " +
      "or install a CLI tool (npm install -g @anthropic-ai/claude-code)."
  );
}

/** API providers that use API keys (excludes CLI and embedding-only providers) */
type APIProviderType = Exclude<LLMProviderType, "jina" | "claude-code" | "codex">;

/**
 * Get API key for a specific provider from config
 * @internal
 */
function getApiKeyForProvider(
  type: APIProviderType,
  config: ProviderFactoryConfig
): string | undefined {
  switch (type) {
    case "openai":
      return config.openaiApiKey;
    case "gemini":
      return config.geminiApiKey;
    case "anthropic":
      return config.anthropicApiKey;
    case "perplexity":
      return config.perplexityApiKey;
    default: {
      const exhaustiveCheck: never = type;
      throw new Error(`Unknown provider type: ${exhaustiveCheck}`);
    }
  }
}
