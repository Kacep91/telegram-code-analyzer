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
