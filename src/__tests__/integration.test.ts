import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createAuthService } from "../auth.js";
import { validateUserMessage, SimpleLimiter } from "../validation.js";

describe("Bot Integration Tests", () => {
  describe("Authorization System", () => {
    it("should authorize users from the provided list", () => {
      const authService = createAuthService([123, 456]);
      expect(authService.isAuthorized(123)).toBe(true);
      expect(authService.isAuthorized(456)).toBe(true);
      expect(authService.isAuthorized(789)).toBe(false);
    });

    it("should reject unauthorized users", () => {
      const authService = createAuthService([100]);
      expect(authService.isAuthorized(999999)).toBe(false);
    });
  });

  describe("Message Validation", () => {
    it("should validate basic message", () => {
      const result = validateUserMessage("Hello world test message");
      expect(result.success).toBe(true);
    });

    it("should reject XSS attempt", () => {
      const result = validateUserMessage('<script>alert("xss")</script>');
      expect(result.success).toBe(false);
    });

    it("should reject too short message", () => {
      const result = validateUserMessage("Hi");
      expect(result.success).toBe(false);
    });

    it("should reject malicious commands", () => {
      const result = validateUserMessage("rm -rf / --no-preserve-root");
      expect(result.success).toBe(false);
    });
  });

  describe("Rate Limiting", () => {
    let limiter: SimpleLimiter;

    beforeEach(() => {
      limiter = new SimpleLimiter({
        maxRequests: 3,
        windowMs: 1000,
        cleanupIntervalMs: 5000,
      });
    });

    afterEach(() => {
      limiter.destroy();
    });

    it("should allow requests within limit", () => {
      const userId = 12345;
      expect(limiter.isAllowed(userId)).toBe(true);
      expect(limiter.isAllowed(userId)).toBe(true);
      expect(limiter.isAllowed(userId)).toBe(true);
    });

    it("should block requests over limit", () => {
      const userId = 12345;
      limiter.isAllowed(userId);
      limiter.isAllowed(userId);
      limiter.isAllowed(userId);
      expect(limiter.isAllowed(userId)).toBe(false);
    });
  });
});
