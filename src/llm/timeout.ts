/**
 * Timeout wrapper for LLM operations
 * @module src/llm/timeout
 */

import { LLMError, LLMErrorSubType } from "../errors/index.js";

/**
 * Options for timeout wrapper
 */
export interface TimeoutOptions {
  /** Timeout duration in milliseconds */
  readonly timeoutMs: number;
  /** Context description for error message */
  readonly context?: string;
  /** Provider name for LLMError */
  readonly provider?: string;
}

/**
 * Wraps a promise with a timeout
 *
 * @typeParam T - Type of the promise result
 * @param promise - Promise to wrap with timeout
 * @param options - Timeout configuration options
 * @returns Promise that rejects with LLMError on timeout
 * @throws LLMError with TIMEOUT subtype if operation times out
 *
 * @example
 * ```typescript
 * const result = await withTimeout(
 *   fetch("https://api.example.com/data"),
 *   { timeoutMs: 5000, context: "API request", provider: "openai" }
 * );
 * ```
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  options: TimeoutOptions
): Promise<T> {
  const { timeoutMs, context = "Operation", provider = "unknown" } = options;

  // Validate timeout value to prevent unexpected behavior
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error(
      `Invalid timeout value: ${timeoutMs}. Must be a positive finite number.`
    );
  }

  let timeoutId: NodeJS.Timeout | undefined;

  // Promise<never> indicates this promise never resolves successfully -
  // it only rejects with a timeout error, allowing TypeScript to infer
  // the correct return type from Promise.race
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(
        new LLMError(
          `${context} timed out after ${timeoutMs}ms`,
          LLMErrorSubType.TIMEOUT,
          provider
        )
      );
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
  }
}

/**
 * Default timeout values for different LLM operations (in milliseconds)
 */
export const DEFAULT_TIMEOUTS = {
  /** Timeout for embedding generation */
  embedding: 30000,
  /** Timeout for completion generation */
  completion: 60000,
  /** Timeout for reranking operations */
  reranking: 90000,
} as const;

/** Type for default timeout keys */
export type TimeoutType = keyof typeof DEFAULT_TIMEOUTS;
