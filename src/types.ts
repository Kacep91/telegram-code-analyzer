// =============================================================================
// Configuration Types
// =============================================================================

export interface RateLimiterConfig {
  readonly maxRequests: number;
  readonly windowMs: number;
  readonly blockDurationMs?: number;
  readonly whitelist?: readonly number[];
  readonly cleanupIntervalMs: number;
}

export interface Config {
  readonly telegramToken: string;
  readonly authorizedUsers: number[];
  readonly projectPath: string;
  readonly claudeTimeout: number;
  readonly rateLimiter: RateLimiterConfig;
}

// =============================================================================
// Analysis Types
// =============================================================================

export interface AnalysisResult {
  readonly summary: string;
  readonly filePath: string;
  readonly fileName: string;
  readonly fileSize: number;
  readonly duration?: number;
  readonly timestamp?: number;
}

// =============================================================================
// Branded Types with Type Guards
// =============================================================================

/**
 * A string that is guaranteed to be non-empty.
 * Use `isNonEmptyString` to check or `asNonEmptyString` to assert.
 */
export type NonEmptyString = string & { readonly __brand: "NonEmpty" };

/**
 * A number that is guaranteed to be positive (> 0).
 * Use `isPositiveNumber` to check or `asPositiveNumber` to assert.
 */
export type PositiveNumber = number & { readonly __brand: "Positive" };

/**
 * Type guard to check if a value is a non-empty string.
 */
export function isNonEmptyString(value: unknown): value is NonEmptyString {
  return typeof value === "string" && value.length > 0;
}

/**
 * Asserts that a string is non-empty and returns it as NonEmptyString.
 * @throws Error if the string is empty or not a string
 */
export function asNonEmptyString(value: string): NonEmptyString {
  if (!value || value.length === 0) {
    throw new Error("String cannot be empty");
  }
  return value as NonEmptyString;
}

/**
 * Type guard to check if a value is a positive number.
 */
export function isPositiveNumber(value: unknown): value is PositiveNumber {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/**
 * Asserts that a number is positive and returns it as PositiveNumber.
 * @throws Error if the number is not positive
 */
export function asPositiveNumber(value: number): PositiveNumber {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error("Number must be positive");
  }
  return value as PositiveNumber;
}

// =============================================================================
// Re-export LLM and RAG types for convenience
// =============================================================================

export type { LLMProviderType } from "./llm/types.js";
export type { RAGConfig } from "./rag/types.js";

// =============================================================================
// Extended Configuration for Multi-LLM Support
// =============================================================================

/**
 * API keys for supported LLM providers
 * @remarks All keys are optional - only configure providers you plan to use
 */
export interface LLMApiKeys {
  readonly openai?: string | undefined;
  readonly gemini?: string | undefined;
  readonly anthropic?: string | undefined;
  readonly perplexity?: string | undefined;
  readonly jina?: string | undefined;
}

/**
 * Extended configuration with LLM and RAG settings
 * @remarks Extends base Config with multi-provider support
 */
export interface ExtendedConfig extends Config {
  /** API keys for LLM providers */
  readonly llmApiKeys: LLMApiKeys;
  /** Default LLM provider for completions (excludes claude-code) */
  readonly defaultLLMProvider: "openai" | "gemini" | "anthropic" | "perplexity";
  /** Path to store RAG index files */
  readonly ragStorePath: string;
  /** RAG pipeline configuration */
  readonly ragConfig: import("./rag/types.js").RAGConfig;
}

// =============================================================================
// User Preferences (per Telegram user)
// =============================================================================

/**
 * Per-user preferences stored in file system
 * @remarks Allows users to select their preferred LLM provider
 */
export interface UserPreferences {
  /** Telegram user ID */
  readonly userId: number;
  /** User's preferred LLM provider for completions */
  readonly preferredProvider: "openai" | "gemini" | "anthropic" | "perplexity";
  /** When preferences were first created */
  readonly createdAt: Date;
  /** When preferences were last updated */
  readonly updatedAt: Date;
}

// =============================================================================
// RAG Status Types
// =============================================================================

/**
 * Current status of RAG index for a project
 * @remarks Used to check if project needs (re)indexing
 */
export interface RAGStatus {
  /** Whether the project has been indexed */
  readonly indexed: boolean;
  /** Number of code chunks in the index */
  readonly chunkCount: number;
  /** ISO timestamp of last indexing, null if never indexed */
  readonly lastIndexed: string | null;
  /** Path to the indexed project, null if not indexed */
  readonly projectPath: string | null;
}
