/**
 * Retry with exponential backoff for LLM API calls
 * @module src/llm/retry
 */

// =============================================================================
// Constants
// =============================================================================

/** Default maximum number of retry attempts */
const DEFAULT_MAX_RETRIES = 3;

/** Default base delay in milliseconds before first retry */
const DEFAULT_BASE_DELAY_MS = 1000;

/** Default maximum delay cap in milliseconds */
const DEFAULT_MAX_DELAY_MS = 30000;

// =============================================================================
// Types
// =============================================================================

/**
 * Callback function invoked on each retry attempt
 * @param attempt - Current attempt number (1-based)
 * @param error - Error that caused the retry
 * @param delayMs - Delay before next attempt in milliseconds
 */
export type RetryCallback = (
  attempt: number,
  error: Error,
  delayMs: number
) => void;

/**
 * Configuration options for retry behavior
 */
export interface RetryOptions {
  /** Maximum number of retry attempts (default: 3) */
  readonly maxRetries?: number;
  /** Base delay in milliseconds before first retry (default: 1000) */
  readonly baseDelayMs?: number;
  /** Maximum delay cap in milliseconds (default: 30000) */
  readonly maxDelayMs?: number;
  /** AbortSignal to cancel retry loop */
  readonly signal?: AbortSignal;
  /** Callback for retry events (replaces console.log) */
  readonly onRetry?: RetryCallback;
}

// =============================================================================
// Retry Logic
// =============================================================================

/**
 * Execute a function with exponential backoff retry
 *
 * @param fn - Async function to execute
 * @param options - Retry configuration options
 * @returns Result of the function
 * @throws Last error if all retries exhausted or non-retryable error
 *
 * @remarks
 * Uses exponential backoff: delay = min(baseDelay * 2^attempt, maxDelay)
 * Only retries on rate limit, timeout, and overload errors
 *
 * @example
 * ```typescript
 * const result = await retryWithBackoff(
 *   () => provider.complete(prompt),
 *   { maxRetries: 3, baseDelayMs: 1000 }
 * );
 * ```
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxRetries = DEFAULT_MAX_RETRIES,
    baseDelayMs = DEFAULT_BASE_DELAY_MS,
    maxDelayMs = DEFAULT_MAX_DELAY_MS,
    signal,
    onRetry,
  } = options;

  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    // Check for cancellation before each attempt
    if (signal?.aborted) {
      throw new Error("Retry cancelled");
    }

    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Don't retry if max attempts reached or error is not retryable
      if (attempt === maxRetries || !isRetryableError(error)) {
        throw lastError;
      }

      // Calculate delay with exponential backoff
      const delay = Math.min(baseDelayMs * Math.pow(2, attempt), maxDelayMs);

      // Notify via callback instead of console.log
      onRetry?.(attempt + 1, lastError, delay);

      await sleep(delay);
    }
  }

  // This should never be reached, but TypeScript needs it
  throw lastError ?? new Error("Retry exhausted without error");
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Check if an error is retryable (rate limit, timeout, server errors)
 * @param error - Error to check
 * @returns True if error can be retried
 *
 * @remarks
 * Retryable errors include:
 * - Rate limit errors (429)
 * - Server errors (500, 502, 503, 504)
 * - Timeout errors
 * - Network/connection errors
 * - Service unavailable/overloaded
 */
export function isRetryableError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();

  // HTTP status codes that are retryable
  const retryableStatusMatch = message.match(/\b(429|500|502|503|504)\b/);
  if (retryableStatusMatch) {
    return true;
  }

  // Rate limit indicators
  const rateLimitPatterns = [
    "rate limit",
    "rate_limit",
    "too many requests",
    "quota exceeded",
    "resource_exhausted",
  ];
  if (rateLimitPatterns.some((pattern) => message.includes(pattern))) {
    return true;
  }

  // Network/timeout errors
  const networkPatterns = [
    "timeout",
    "timed out",
    "etimedout",
    "econnreset",
    "econnrefused",
    "socket hang up",
    "network error",
    "fetch failed",
    "connection reset",
    "aborted",
  ];
  if (networkPatterns.some((pattern) => message.includes(pattern))) {
    return true;
  }

  // Service unavailable/overloaded
  if (
    message.includes("service unavailable") ||
    message.includes("temporarily unavailable") ||
    message.includes("overloaded")
  ) {
    return true;
  }

  return false;
}

/**
 * Sleep for specified milliseconds
 * @param ms - Milliseconds to sleep
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
