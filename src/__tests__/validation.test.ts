import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SimpleLimiter } from "../validation.js";
import type { RateLimiterConfig } from "../types.js";

describe("SimpleLimiter", () => {
  let limiter: SimpleLimiter;
  const config: RateLimiterConfig = {
    maxRequests: 5,
    windowMs: 60000,
    cleanupIntervalMs: 30000,
  };

  beforeEach(() => {
    vi.useFakeTimers();
    limiter = new SimpleLimiter(config);
  });

  afterEach(() => {
    limiter.destroy();
    vi.useRealTimers();
  });

  describe("constructor", () => {
    it("should initialize with config and start cleanup timer", () => {
      const stats = limiter.getStats();

      expect(stats.config).toEqual(config);
      expect(stats.totalUsers).toBe(0);
      expect(stats.totalRequests).toBe(0);
    });
  });

  describe("isAllowed", () => {
    it("should allow first request", () => {
      const userId = 12345;

      const result = limiter.isAllowed(userId);

      expect(result).toBe(true);
      expect(limiter.getUserRequestCount(userId)).toBe(1);
    });

    it("should allow requests within limit", () => {
      const userId = 12345;

      for (let i = 0; i < config.maxRequests; i++) {
        expect(limiter.isAllowed(userId)).toBe(true);
      }

      expect(limiter.getUserRequestCount(userId)).toBe(config.maxRequests);
    });

    it("should deny when limit exceeded", () => {
      const userId = 12345;

      // Use up all allowed requests
      for (let i = 0; i < config.maxRequests; i++) {
        limiter.isAllowed(userId);
      }

      // Next request should be denied
      const result = limiter.isAllowed(userId);

      expect(result).toBe(false);
      expect(limiter.getUserRequestCount(userId)).toBe(config.maxRequests);
    });

    it("should reset after window expires", () => {
      const userId = 12345;

      // Use up all requests
      for (let i = 0; i < config.maxRequests; i++) {
        limiter.isAllowed(userId);
      }
      expect(limiter.isAllowed(userId)).toBe(false);

      // Advance time past the window
      vi.advanceTimersByTime(config.windowMs + 1);

      // Should be allowed again
      const result = limiter.isAllowed(userId);

      expect(result).toBe(true);
      expect(limiter.getUserRequestCount(userId)).toBe(1);
    });

    it("should trigger cleanup when MAX_TRACKED_USERS (10000) is reached", () => {
      // Create 10000 users (max limit)
      for (let i = 0; i < 10000; i++) {
        limiter.isAllowed(i);
      }

      expect(limiter.getStats().totalUsers).toBe(10000);

      // Advance time so all requests are expired
      vi.advanceTimersByTime(config.windowMs + 1);

      // Adding one more user should trigger cleanup (removing all expired)
      limiter.isAllowed(10001);

      // After cleanup, only the new user should remain
      expect(limiter.getStats().totalUsers).toBe(1);
    });
  });

  describe("getUserRequestCount", () => {
    it("should return 0 for unknown user", () => {
      const result = limiter.getUserRequestCount(99999);

      expect(result).toBe(0);
    });

    it("should return correct count for active user", () => {
      const userId = 12345;

      limiter.isAllowed(userId);
      limiter.isAllowed(userId);
      limiter.isAllowed(userId);

      const result = limiter.getUserRequestCount(userId);

      expect(result).toBe(3);
    });
  });

  describe("getTimeUntilReset", () => {
    it("should return 0 for unknown user", () => {
      const result = limiter.getTimeUntilReset(99999);

      expect(result).toBe(0);
    });

    it("should return correct time until reset", () => {
      const userId = 12345;
      limiter.isAllowed(userId);

      // Advance time by half the window
      vi.advanceTimersByTime(30000);

      const result = limiter.getTimeUntilReset(userId);

      // Should have roughly half the window left
      expect(result).toBe(30000);
    });
  });

  describe("cleanup", () => {
    it("should remove old entries after advancing time", () => {
      const userId1 = 111;
      const userId2 = 222;

      limiter.isAllowed(userId1);
      limiter.isAllowed(userId2);

      expect(limiter.getStats().totalUsers).toBe(2);

      // Advance time past window and trigger cleanup via interval
      vi.advanceTimersByTime(config.windowMs + config.cleanupIntervalMs + 1);

      expect(limiter.getStats().totalUsers).toBe(0);
    });

    it("should keep recent entries", () => {
      const userId1 = 111;
      const userId2 = 222;

      limiter.isAllowed(userId1);

      // Advance time but not past the window
      vi.advanceTimersByTime(20000);

      limiter.isAllowed(userId2);

      // Trigger cleanup (20000 + 30000 = 50000ms total, still within 60000ms window)
      vi.advanceTimersByTime(config.cleanupIntervalMs);

      // Both users should still be present (their requests are within window)
      expect(limiter.getStats().totalUsers).toBe(2);
    });
  });

  describe("destroy", () => {
    it("should clear interval and requests", () => {
      const userId = 12345;
      limiter.isAllowed(userId);
      limiter.isAllowed(userId);

      expect(limiter.getStats().totalUsers).toBe(1);
      expect(limiter.getStats().totalRequests).toBe(2);

      limiter.destroy();

      expect(limiter.getStats().totalUsers).toBe(0);
      expect(limiter.getStats().totalRequests).toBe(0);
    });
  });

  describe("getStats", () => {
    it("should return correct totalUsers count", () => {
      limiter.isAllowed(111);
      limiter.isAllowed(222);
      limiter.isAllowed(333);

      const stats = limiter.getStats();

      expect(stats.totalUsers).toBe(3);
    });

    it("should return correct totalRequests count", () => {
      limiter.isAllowed(111);
      limiter.isAllowed(111);
      limiter.isAllowed(222);
      limiter.isAllowed(222);
      limiter.isAllowed(222);

      const stats = limiter.getStats();

      expect(stats.totalRequests).toBe(5);
    });

    it("should return config", () => {
      const stats = limiter.getStats();

      expect(stats.config).toEqual(config);
      expect(stats.config.maxRequests).toBe(5);
      expect(stats.config.windowMs).toBe(60000);
      expect(stats.config.cleanupIntervalMs).toBe(30000);
    });
  });
});

import {
  validateUserMessage,
  validateTelegramUserId,
  validateUsername,
  sanitizeMessage,
  isSpamMessage,
  sanitizeText,
} from "../validation.js";

describe("validateUserMessage", () => {
  it("should return success for valid message", () => {
    const result = validateUserMessage("Hello, this is a valid message!");

    expect(result.success).toBe(true);
    expect(result.data).toBe("Hello, this is a valid message!");
  });

  it("should fail for non-string input", () => {
    const result = validateUserMessage(12345);

    expect(result.success).toBe(false);
    expect(result.error).toBe("Message must be a string");
  });

  it("should fail for null input", () => {
    const result = validateUserMessage(null);

    expect(result.success).toBe(false);
    expect(result.error).toBe("Message must be a string");
  });

  it("should fail for undefined input", () => {
    const result = validateUserMessage(undefined);

    expect(result.success).toBe(false);
    expect(result.error).toBe("Message must be a string");
  });

  it("should fail for message too short (<5 chars)", () => {
    const result = validateUserMessage("Hi!");

    expect(result.success).toBe(false);
    expect(result.error).toBe("Message too short (minimum 5 characters)");
  });

  it("should fail for message exactly at minimum boundary minus one", () => {
    const result = validateUserMessage("abcd");

    expect(result.success).toBe(false);
    expect(result.error).toBe("Message too short (minimum 5 characters)");
  });

  it("should pass for message exactly at minimum boundary", () => {
    const result = validateUserMessage("abcde");

    expect(result.success).toBe(true);
    expect(result.data).toBe("abcde");
  });

  it("should fail for message too long (>2000 chars)", () => {
    const longMessage = "a".repeat(2001);

    const result = validateUserMessage(longMessage);

    expect(result.success).toBe(false);
    expect(result.error).toBe("Message too long (maximum 2000 characters)");
  });

  it("should pass for message exactly at maximum boundary", () => {
    const maxMessage = "a".repeat(2000);

    const result = validateUserMessage(maxMessage);

    expect(result.success).toBe(true);
    expect(result.data).toBe(maxMessage);
  });

  it("should fail for invalid characters (emoji)", () => {
    const result = validateUserMessage("Hello world 🌍");

    expect(result.success).toBe(false);
    expect(result.error).toBe("Message contains invalid characters");
  });

  it("should fail for <script tag (suspicious)", () => {
    const result = validateUserMessage("Check this <script>alert(1)</script>");

    expect(result.success).toBe(false);
    expect(result.error).toBe("Message contains suspicious content");
  });

  it("should fail for javascript: protocol (suspicious)", () => {
    const result = validateUserMessage("Click here javascript:alert(1)");

    expect(result.success).toBe(false);
    expect(result.error).toBe("Message contains suspicious content");
  });

  it("should fail for data: protocol (suspicious)", () => {
    const result = validateUserMessage("Image data:text/html,<script>x</script>");

    expect(result.success).toBe(false);
    expect(result.error).toBe("Message contains suspicious content");
  });

  it("should fail for eval keyword (suspicious)", () => {
    const result = validateUserMessage("Please run eval in the code");

    expect(result.success).toBe(false);
    expect(result.error).toBe("Message contains suspicious content");
  });

  it("should fail for exec keyword (suspicious)", () => {
    const result = validateUserMessage("Can you exec this command?");

    expect(result.success).toBe(false);
    expect(result.error).toBe("Message contains suspicious content");
  });

  it("should fail for rm -rf (suspicious)", () => {
    const result = validateUserMessage("Run rm -rf / on the server");

    expect(result.success).toBe(false);
    expect(result.error).toBe("Message contains suspicious content");
  });

  it("should fail for sudo (suspicious)", () => {
    const result = validateUserMessage("Execute sudo apt-get install");

    expect(result.success).toBe(false);
    expect(result.error).toBe("Message contains suspicious content");
  });

  it("should fail for system keyword (suspicious)", () => {
    const result = validateUserMessage("Call the system function here");

    expect(result.success).toBe(false);
    expect(result.error).toBe("Message contains suspicious content");
  });

  it("should fail for onclick (suspicious)", () => {
    const result = validateUserMessage("Add an onclick handler there");

    expect(result.success).toBe(false);
    expect(result.error).toBe("Message contains suspicious content");
  });

  it("should fail for onerror (suspicious)", () => {
    const result = validateUserMessage("Use onerror to catch it");

    expect(result.success).toBe(false);
    expect(result.error).toBe("Message contains suspicious content");
  });

  it("should fail for vbscript: protocol (suspicious)", () => {
    const result = validateUserMessage("Try vbscript:msgbox()");

    expect(result.success).toBe(false);
    expect(result.error).toBe("Message contains suspicious content");
  });

  it("should fail for $( pattern (suspicious)", () => {
    const result = validateUserMessage("Run $(whoami) command");

    expect(result.success).toBe(false);
    expect(result.error).toBe("Message contains suspicious content");
  });

  it("should allow Russian text (кириллица)", () => {
    const result = validateUserMessage("Привет, как дела? Это тестовое сообщение на русском языке.");

    expect(result.success).toBe(true);
    expect(result.data).toBe("Привет, как дела? Это тестовое сообщение на русском языке.");
  });

  it("should allow Russian text with Ё character", () => {
    const result = validateUserMessage("Ёлка и ёжик - тёплое приветствие!");

    expect(result.success).toBe(true);
    expect(result.data).toBe("Ёлка и ёжик - тёплое приветствие!");
  });

  it("should allow programming characters ()[]{}|", () => {
    const result = validateUserMessage("function test() { return [1, 2, 3]; }");

    expect(result.success).toBe(true);
    expect(result.data).toBe("function test() { return [1, 2, 3]; }");
  });

  it("should allow special programming characters @#$%^&*+=", () => {
    const result = validateUserMessage("Check @user #tag $var 100% test^2 a&b c*d e+f g=h");

    expect(result.success).toBe(true);
  });

  it("should allow pipe, tilde, backtick and backslash", () => {
    const result = validateUserMessage("Use | pipe ~ tilde ` backtick \\ backslash");

    expect(result.success).toBe(true);
  });

  it("should allow quotes and apostrophes", () => {
    const result = validateUserMessage("Say 'hello' and \"world\" today");

    expect(result.success).toBe(true);
  });

  it("should allow forward slash and underscore", () => {
    const result = validateUserMessage("Path /home/user_name/file.txt works");

    expect(result.success).toBe(true);
  });

  it("should allow punctuation marks", () => {
    const result = validateUserMessage("Hello, world! How are you? Fine: yes; maybe...");

    expect(result.success).toBe(true);
  });
});

describe("validateTelegramUserId", () => {
  it("should return success for valid user ID", () => {
    const result = validateTelegramUserId(123456789);

    expect(result.success).toBe(true);
    expect(result.data).toBe(123456789);
  });

  it("should return success for minimum valid ID (1)", () => {
    const result = validateTelegramUserId(1);

    expect(result.success).toBe(true);
    expect(result.data).toBe(1);
  });

  it("should return success for maximum valid ID", () => {
    const result = validateTelegramUserId(999999999999);

    expect(result.success).toBe(true);
    expect(result.data).toBe(999999999999);
  });

  it("should fail for non-number input (string)", () => {
    const result = validateTelegramUserId("123456");

    expect(result.success).toBe(false);
    expect(result.error).toBe("User ID must be a number");
  });

  it("should fail for non-number input (null)", () => {
    const result = validateTelegramUserId(null);

    expect(result.success).toBe(false);
    expect(result.error).toBe("User ID must be a number");
  });

  it("should fail for non-number input (undefined)", () => {
    const result = validateTelegramUserId(undefined);

    expect(result.success).toBe(false);
    expect(result.error).toBe("User ID must be a number");
  });

  it("should fail for non-number input (object)", () => {
    const result = validateTelegramUserId({ id: 123 });

    expect(result.success).toBe(false);
    expect(result.error).toBe("User ID must be a number");
  });

  it("should fail for non-integer (float)", () => {
    const result = validateTelegramUserId(123.456);

    expect(result.success).toBe(false);
    expect(result.error).toBe("User ID must be an integer");
  });

  it("should fail for zero", () => {
    const result = validateTelegramUserId(0);

    expect(result.success).toBe(false);
    expect(result.error).toBe("User ID must be a positive number");
  });

  it("should fail for negative number", () => {
    const result = validateTelegramUserId(-123);

    expect(result.success).toBe(false);
    expect(result.error).toBe("User ID must be a positive number");
  });

  it("should fail for ID too large (>999999999999)", () => {
    const result = validateTelegramUserId(1000000000000);

    expect(result.success).toBe(false);
    expect(result.error).toBe("User ID too large");
  });

  it("should fail for NaN", () => {
    const result = validateTelegramUserId(NaN);

    expect(result.success).toBe(false);
    expect(result.error).toBe("User ID must be an integer");
  });

  it("should fail for Infinity", () => {
    const result = validateTelegramUserId(Infinity);

    expect(result.success).toBe(false);
    expect(result.error).toBe("User ID must be an integer");
  });
});

describe("validateUsername", () => {
  it("should return success for valid username", () => {
    const result = validateUsername("john_doe");

    expect(result.success).toBe(true);
    expect(result.data).toBe("john_doe");
  });

  it("should return success for username with dots", () => {
    const result = validateUsername("john.doe");

    expect(result.success).toBe(true);
    expect(result.data).toBe("john.doe");
  });

  it("should return success for username with hyphens", () => {
    const result = validateUsername("john-doe");

    expect(result.success).toBe(true);
    expect(result.data).toBe("john-doe");
  });

  it("should return success for username with spaces", () => {
    const result = validateUsername("John Doe");

    expect(result.success).toBe(true);
    expect(result.data).toBe("John Doe");
  });

  it("should return success for single character username", () => {
    const result = validateUsername("A");

    expect(result.success).toBe(true);
    expect(result.data).toBe("A");
  });

  it("should fail for non-string input (number)", () => {
    const result = validateUsername(12345);

    expect(result.success).toBe(false);
    expect(result.error).toBe("Username must be a string");
  });

  it("should fail for non-string input (null)", () => {
    const result = validateUsername(null);

    expect(result.success).toBe(false);
    expect(result.error).toBe("Username must be a string");
  });

  it("should fail for non-string input (undefined)", () => {
    const result = validateUsername(undefined);

    expect(result.success).toBe(false);
    expect(result.error).toBe("Username must be a string");
  });

  it("should fail for empty string", () => {
    const result = validateUsername("");

    expect(result.success).toBe(false);
    expect(result.error).toBe("Username cannot be empty");
  });

  it("should fail for username too long (>100 chars)", () => {
    const longUsername = "a".repeat(101);

    const result = validateUsername(longUsername);

    expect(result.success).toBe(false);
    expect(result.error).toBe("Username too long");
  });

  it("should pass for username exactly at maximum boundary", () => {
    const maxUsername = "a".repeat(100);

    const result = validateUsername(maxUsername);

    expect(result.success).toBe(true);
    expect(result.data).toBe(maxUsername);
  });

  it("should fail for invalid characters (special symbols)", () => {
    const result = validateUsername("john@doe!");

    expect(result.success).toBe(false);
    expect(result.error).toBe("Invalid characters in username");
  });

  it("should fail for invalid characters (brackets)", () => {
    const result = validateUsername("john[doe]");

    expect(result.success).toBe(false);
    expect(result.error).toBe("Invalid characters in username");
  });

  it("should allow Russian username", () => {
    const result = validateUsername("Иван Петров");

    expect(result.success).toBe(true);
    expect(result.data).toBe("Иван Петров");
  });

  it("should allow mixed Russian and Latin characters", () => {
    const result = validateUsername("User Пользователь123");

    expect(result.success).toBe(true);
    expect(result.data).toBe("User Пользователь123");
  });

  it("should allow numeric username", () => {
    const result = validateUsername("123456");

    expect(result.success).toBe(true);
    expect(result.data).toBe("123456");
  });
});

describe("sanitizeMessage", () => {
  it("should trim leading whitespace", () => {
    const result = sanitizeMessage("   Hello world");

    expect(result).toBe("Hello world");
  });

  it("should trim trailing whitespace", () => {
    const result = sanitizeMessage("Hello world   ");

    expect(result).toBe("Hello world");
  });

  it("should trim both leading and trailing whitespace", () => {
    const result = sanitizeMessage("   Hello world   ");

    expect(result).toBe("Hello world");
  });

  it("should collapse multiple spaces to single space", () => {
    const result = sanitizeMessage("Hello    world   test");

    expect(result).toBe("Hello world test");
  });

  it("should collapse tabs and newlines to single space", () => {
    const result = sanitizeMessage("Hello\t\tworld\n\ntest");

    expect(result).toBe("Hello world test");
  });

  it("should remove < character", () => {
    const result = sanitizeMessage("Hello <world> test");

    expect(result).toBe("Hello world test");
  });

  it("should remove > character", () => {
    const result = sanitizeMessage("Test > value > end");

    expect(result).toBe("Test value end");
  });

  it("should remove multiple < and > characters", () => {
    const result = sanitizeMessage("<<script>>alert<</script>>");

    expect(result).toBe("scriptalert/script");
  });

  it("should handle double spaces after removing <>", () => {
    // Edge case: when <> removal leaves double spaces, they should be collapsed
    const result = sanitizeMessage("Hello <> world");

    expect(result).toBe("Hello world");
  });

  it("should truncate to max length (2000 chars)", () => {
    const longMessage = "a".repeat(2500);

    const result = sanitizeMessage(longMessage);

    expect(result.length).toBe(2000);
    expect(result).toBe("a".repeat(2000));
  });

  it("should not truncate message within limit", () => {
    const message = "Hello world";

    const result = sanitizeMessage(message);

    expect(result).toBe("Hello world");
  });

  it("should handle empty string", () => {
    const result = sanitizeMessage("");

    expect(result).toBe("");
  });

  it("should handle string with only whitespace", () => {
    const result = sanitizeMessage("     ");

    expect(result).toBe("");
  });

  it("should apply all transformations together", () => {
    const result = sanitizeMessage("   <Hello>   world   <test>   ");

    expect(result).toBe("Hello world test");
  });
});

describe("isSpamMessage", () => {
  let rateLimiter: SimpleLimiter;
  const spamConfig: RateLimiterConfig = {
    maxRequests: 2,
    windowMs: 60000,
    cleanupIntervalMs: 30000,
  };

  beforeEach(() => {
    vi.useFakeTimers();
    rateLimiter = new SimpleLimiter(spamConfig);
  });

  afterEach(() => {
    rateLimiter.destroy();
    vi.useRealTimers();
  });

  it("should return false when user is allowed (first request)", () => {
    const userId = 12345;

    const result = isSpamMessage(userId, rateLimiter);

    expect(result).toBe(false);
  });

  it("should return false when user is within rate limit", () => {
    const userId = 12345;

    // First request
    isSpamMessage(userId, rateLimiter);

    // Second request (still within limit of 2)
    const result = isSpamMessage(userId, rateLimiter);

    expect(result).toBe(false);
  });

  it("should return true when rate limited (exceeded max requests)", () => {
    const userId = 12345;

    // Use up all allowed requests
    isSpamMessage(userId, rateLimiter);
    isSpamMessage(userId, rateLimiter);

    // Third request should be spam
    const result = isSpamMessage(userId, rateLimiter);

    expect(result).toBe(true);
  });

  it("should return false after rate limit window expires", () => {
    const userId = 12345;

    // Use up all requests
    isSpamMessage(userId, rateLimiter);
    isSpamMessage(userId, rateLimiter);
    expect(isSpamMessage(userId, rateLimiter)).toBe(true);

    // Advance time past the window
    vi.advanceTimersByTime(spamConfig.windowMs + 1);

    // Should be allowed again
    const result = isSpamMessage(userId, rateLimiter);

    expect(result).toBe(false);
  });

  it("should track different users independently", () => {
    const userId1 = 111;
    const userId2 = 222;

    // Use up all requests for user1
    isSpamMessage(userId1, rateLimiter);
    isSpamMessage(userId1, rateLimiter);
    expect(isSpamMessage(userId1, rateLimiter)).toBe(true);

    // User2 should still be allowed
    const result = isSpamMessage(userId2, rateLimiter);

    expect(result).toBe(false);
  });
});

describe("sanitizeText", () => {
  it("should call sanitizeMessage and return same result", () => {
    const input = "   Hello   world   ";

    const sanitizeTextResult = sanitizeText(input);
    const sanitizeMessageResult = sanitizeMessage(input);

    expect(sanitizeTextResult).toBe(sanitizeMessageResult);
    expect(sanitizeTextResult).toBe("Hello world");
  });

  it("should trim whitespace", () => {
    const result = sanitizeText("  test  ");

    expect(result).toBe("test");
  });

  it("should collapse multiple spaces", () => {
    const result = sanitizeText("hello    world");

    expect(result).toBe("hello world");
  });

  it("should remove angle brackets", () => {
    const result = sanitizeText("<div>content</div>");

    expect(result).toBe("divcontent/div");
  });

  it("should truncate long text", () => {
    const longText = "x".repeat(2500);

    const result = sanitizeText(longText);

    expect(result.length).toBe(2000);
  });
});
