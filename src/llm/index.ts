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

import type {
  LLMProviderType,
  LLMCompletionProvider,
  LLMEmbeddingProvider,
  LLMFullProvider,
  ProviderFactoryConfig,
} from "./types.js";
import { ProviderFactoryConfigSchema } from "./types.js";
import { OpenAIProvider } from "./openai.js";
import { GeminiProvider } from "./gemini.js";
import { AnthropicProvider } from "./anthropic.js";
import { PerplexityProvider } from "./perplexity.js";
import { JinaEmbeddingProvider } from "./jina.js";

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
    embedding: ["text-embedding-004", "gemini-embedding-001"],
    default: { chat: "gemini-2.0-flash", embedding: "text-embedding-004" },
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
      throw new Error(
        "claude-code provider must be created directly, not through factory"
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
  if (type === "anthropic" || type === "perplexity" || type === "claude-code") {
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
  if (type === "anthropic" || type === "perplexity" || type === "claude-code") {
    throw new Error(
      `${type} does not support embeddings. Use OpenAI or Gemini for full provider.`
    );
  }

  switch (type) {
    case "openai":
      return new OpenAIProvider(apiKey);
    case "gemini":
      return new GeminiProvider({ apiKey });
    default: {
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
  if (type === "claude-code") {
    return {
      available: false,
      error:
        "claude-code provider availability check not supported via factory",
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
