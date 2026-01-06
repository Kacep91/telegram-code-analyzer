import { RateLimiterConfig } from "./types.js";
import { getConfigValue } from "./utils.js";

const MAX_TELEGRAM_USER_ID = 999999999999;

function validateUserMessageSimple(message: unknown): ValidationResult<string> {
  if (typeof message !== "string") {
    return { success: false, error: "Message must be a string" };
  }

  const minLength = getConfigValue("VALIDATION_MESSAGE_MIN_LENGTH");
  const maxLength = getConfigValue("VALIDATION_MESSAGE_MAX_LENGTH");

  if (message.length < minLength) {
    return {
      success: false,
      error: `Message too short (minimum ${minLength} characters)`,
    };
  }

  if (message.length > maxLength) {
    return {
      success: false,
      error: `Message too long (maximum ${maxLength} characters)`,
    };
  }

  // Allow common programming characters needed for code questions
  // WARNING: <> symbols allowed intentionally - protection relies on suspiciousPatterns check below
  // Do NOT remove suspiciousPatterns without updating this regex to exclude <>
  if (
    !/^[a-zA-Z0-9а-яА-ЯёЁ\s.,?!:;\-()[\]"'/_@#$%^&*+=|~`\\{}<>]+$/.test(message)
  ) {
    return { success: false, error: "Message contains invalid characters" };
  }

  const suspiciousPatterns = [
    /<script/i,
    /javascript:/i,
    /data:/i,
    /vbscript:/i,
    /onclick/i,
    /onerror/i,
    /\$\(/,
    /\beval\b/i,
    /\bexec\b/i,
    /\bsystem\b/i,
    /\brm\s+-rf/i,
    /\bsudo\b/i,
  ];

  if (suspiciousPatterns.some((pattern) => pattern.test(message))) {
    return {
      success: false,
      error: "Message contains suspicious content",
    };
  }

  return { success: true, data: message };
}

function validateTelegramUserIdSimple(
  userId: unknown
): ValidationResult<number> {
  if (typeof userId !== "number") {
    return { success: false, error: "User ID must be a number" };
  }

  if (!Number.isInteger(userId)) {
    return { success: false, error: "User ID must be an integer" };
  }

  if (userId <= 0) {
    return {
      success: false,
      error: "User ID must be a positive number",
    };
  }

  if (userId > MAX_TELEGRAM_USER_ID) {
    return { success: false, error: "User ID too large" };
  }

  return { success: true, data: userId };
}

function validateUsernameSimple(username: unknown): ValidationResult<string> {
  if (typeof username !== "string") {
    return { success: false, error: "Username must be a string" };
  }

  if (username.length === 0) {
    return { success: false, error: "Username cannot be empty" };
  }

  if (username.length > getConfigValue("VALIDATION_USERNAME_MAX_LENGTH")) {
    return { success: false, error: "Username too long" };
  }

  if (!/^[a-zA-Z0-9а-яА-Я\s._-]+$/.test(username)) {
    return {
      success: false,
      error: "Invalid characters in username",
    };
  }

  return { success: true, data: username };
}

export type ValidatedUserMessage = string;
export type ValidatedTelegramUserId = number;
export type ValidatedUsername = string;

export interface ValidationResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}

export function sanitizeMessage(message: string): string {
  return message
    .trim()
    // Order matters: remove <> first, then collapse spaces that may appear
    // (e.g., "Hello > world" -> "Hello  world" -> "Hello world")
    .replace(/[<>]/g, "")
    .replace(/\s+/g, " ")
    .substring(0, getConfigValue("VALIDATION_MESSAGE_MAX_LENGTH"));
}

class SimpleLimiter {
  private requests = new Map<number, number[]>();
  private readonly config: RateLimiterConfig;
  private cleanupIntervalId: NodeJS.Timeout | null = null;

  constructor(config: RateLimiterConfig) {
    this.config = config;
    this.startCleanupTimer();
  }

  public isAllowed(userId: number): boolean {
    // Prevent unbounded memory growth
    const maxTrackedUsers = getConfigValue("RATE_LIMITER_MAX_TRACKED_USERS");
    if (this.requests.size >= maxTrackedUsers) {
      this.cleanup();
    }

    const now = Date.now();
    const userRequests = this.requests.get(userId) || [];

    const recentRequests = userRequests.filter(
      (time) => now - time < this.config.windowMs
    );

    if (recentRequests.length >= this.config.maxRequests) {
      return false;
    }

    recentRequests.push(now);
    this.requests.set(userId, recentRequests);

    return true;
  }

  public getUserRequestCount(userId: number): number {
    const now = Date.now();
    const userRequests = this.requests.get(userId) || [];

    return userRequests.filter((time) => now - time < this.config.windowMs)
      .length;
  }

  public getTimeUntilReset(userId: number): number {
    const userRequests = this.requests.get(userId) || [];
    if (userRequests.length === 0) return 0;

    const now = Date.now();
    const oldestRequest = Math.min(...userRequests);
    const resetTime = oldestRequest + this.config.windowMs;

    return Math.max(0, resetTime - now);
  }

  private startCleanupTimer(): void {
    this.cleanupIntervalId = setInterval(() => {
      this.cleanup();
    }, this.config.cleanupIntervalMs);
  }

  private cleanup(): void {
    const now = Date.now();
    const cutoffTime = now - this.config.windowMs;

    for (const [userId, requests] of this.requests.entries()) {
      const recentRequests = requests.filter((time) => time > cutoffTime);

      if (recentRequests.length === 0) {
        this.requests.delete(userId);
      } else if (recentRequests.length < requests.length) {
        this.requests.set(userId, recentRequests);
      }
    }
  }

  public destroy(): void {
    if (this.cleanupIntervalId) {
      clearInterval(this.cleanupIntervalId);
      this.cleanupIntervalId = null;
    }
    this.requests.clear();
  }

  public getStats(): {
    totalUsers: number;
    totalRequests: number;
    config: RateLimiterConfig;
  } {
    let totalRequests = 0;
    for (const requests of this.requests.values()) {
      totalRequests += requests.length;
    }

    return {
      totalUsers: this.requests.size,
      totalRequests,
      config: this.config,
    };
  }
}

export { SimpleLimiter };

export function validateUserMessage(
  message: unknown
): ValidationResult<ValidatedUserMessage> {
  return validateUserMessageSimple(message);
}

export function validateTelegramUserId(
  userId: unknown
): ValidationResult<ValidatedTelegramUserId> {
  return validateTelegramUserIdSimple(userId);
}

export function validateUsername(
  username: unknown
): ValidationResult<ValidatedUsername> {
  return validateUsernameSimple(username);
}

export function isSpamMessage(
  userId: number,
  rateLimiter: SimpleLimiter
): boolean {
  return !rateLimiter.isAllowed(userId);
}

export function sanitizeText(text: string): string {
  return sanitizeMessage(text);
}
