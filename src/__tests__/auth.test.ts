/**
 * Unit tests for auth.ts module
 *
 * Tests AuthService and authMiddleware functionality.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Context, NextFunction } from "grammy";
import { createAuthService, authMiddleware, AuthService } from "../auth.js";

// =============================================================================
// Mock logger
// =============================================================================

vi.mock("../utils.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// =============================================================================
// Helper Functions
// =============================================================================

interface MockContext {
  from: { id: number } | undefined;
  reply: ReturnType<typeof vi.fn>;
}

/**
 * Creates a mock grammy Context for testing authMiddleware
 */
function createMockContext(userId?: number): MockContext {
  return {
    from: userId !== undefined ? { id: userId } : undefined,
    reply: vi.fn().mockResolvedValue({}),
  };
}

/**
 * Type for middleware function
 */
type MiddlewareFn = (ctx: Context, next: NextFunction) => Promise<void>;

/**
 * Helper to call middleware with proper typing
 */
async function callMiddleware(
  middleware: ReturnType<typeof authMiddleware>,
  ctx: MockContext,
  next: NextFunction
): Promise<void> {
  // authMiddleware always returns a function, not MiddlewareObj
  const middlewareFn = middleware as MiddlewareFn;
  await middlewareFn(ctx as unknown as Context, next);
}

// =============================================================================
// Tests
// =============================================================================

describe("auth.ts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ===========================================================================
  // createAuthService Tests
  // ===========================================================================

  describe("createAuthService", () => {
    it("should return true for authorized user", () => {
      const authService = createAuthService([123, 456, 789]);
      expect(authService.isAuthorized(123)).toBe(true);
    });

    it("should return false for unauthorized user", () => {
      const authService = createAuthService([123, 456, 789]);
      expect(authService.isAuthorized(999)).toBe(false);
    });

    it("should handle empty authorized users list", () => {
      const authService = createAuthService([]);
      expect(authService.isAuthorized(123)).toBe(false);
    });

    it("should handle single authorized user", () => {
      const authService = createAuthService([123]);
      expect(authService.isAuthorized(123)).toBe(true);
      expect(authService.isAuthorized(456)).toBe(false);
    });

    it("should log warning for unauthorized access attempt", async () => {
      const { logger } = await import("../utils.js");
      const authService = createAuthService([123]);

      authService.isAuthorized(999);

      expect(logger.warn).toHaveBeenCalledWith("Unauthorized access attempt");
    });

    it("should not log warning for authorized access", async () => {
      const { logger } = await import("../utils.js");
      vi.mocked(logger.warn).mockClear();

      const authService = createAuthService([123]);
      authService.isAuthorized(123);

      expect(logger.warn).not.toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // authMiddleware Tests
  // ===========================================================================

  describe("authMiddleware", () => {
    let authService: AuthService;

    beforeEach(() => {
      authService = createAuthService([123456789, 987654321]);
    });

    it("should call next() for authorized user", async () => {
      const ctx = createMockContext(123456789);
      const next = vi.fn().mockResolvedValue(undefined);
      const middleware = authMiddleware(authService);

      await callMiddleware(middleware, ctx, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(ctx.reply).not.toHaveBeenCalled();
    });

    it("should reply 'Access denied' for unauthorized user", async () => {
      const ctx = createMockContext(111111111);
      const next = vi.fn().mockResolvedValue(undefined);
      const middleware = authMiddleware(authService);

      await callMiddleware(middleware, ctx, next);

      expect(ctx.reply).toHaveBeenCalledWith(
        expect.stringContaining("Access denied")
      );
    });

    it("should reply 'Access denied' when ctx.from is undefined", async () => {
      const ctx = createMockContext(undefined);
      const next = vi.fn().mockResolvedValue(undefined);
      const middleware = authMiddleware(authService);

      await callMiddleware(middleware, ctx, next);

      expect(ctx.reply).toHaveBeenCalledWith(
        expect.stringContaining("Access denied")
      );
    });

    it("should not call next() for unauthorized user", async () => {
      const ctx = createMockContext(111111111);
      const next = vi.fn().mockResolvedValue(undefined);
      const middleware = authMiddleware(authService);

      await callMiddleware(middleware, ctx, next);

      expect(next).not.toHaveBeenCalled();
    });

    it("should not call next() when ctx.from is undefined", async () => {
      const ctx = createMockContext(undefined);
      const next = vi.fn().mockResolvedValue(undefined);
      const middleware = authMiddleware(authService);

      await callMiddleware(middleware, ctx, next);

      expect(next).not.toHaveBeenCalled();
    });

    it("should handle second authorized user correctly", async () => {
      const ctx = createMockContext(987654321);
      const next = vi.fn().mockResolvedValue(undefined);
      const middleware = authMiddleware(authService);

      await callMiddleware(middleware, ctx, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(ctx.reply).not.toHaveBeenCalled();
    });

    it("should await next() properly", async () => {
      const ctx = createMockContext(123456789);
      let nextCalled = false;
      const next = vi.fn().mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        nextCalled = true;
      });
      const middleware = authMiddleware(authService);

      await callMiddleware(middleware, ctx, next);

      expect(nextCalled).toBe(true);
    });
  });
});
