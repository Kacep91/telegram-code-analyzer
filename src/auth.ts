import { Middleware, Context } from "grammy";
import { logger } from "./utils.js";

export interface AuthService {
  isAuthorized(userId: number): boolean;
  isAdmin(userId: number): boolean;
}

export function createAuthService(
  authorizedUsers: number[],
  adminUsers: number[] = []
): AuthService {
  const usersSet = new Set(authorizedUsers);
  const adminsSet = new Set(adminUsers);

  return {
    isAuthorized: (userId: number) => {
      // Admins are also authorized
      const authorized = usersSet.has(userId) || adminsSet.has(userId);
      if (!authorized) {
        logger.warn("Unauthorized access attempt");
      }
      return authorized;
    },
    isAdmin: (userId: number) => adminsSet.has(userId),
  };
}

export function authMiddleware(authService: AuthService): Middleware<Context> {
  return async (ctx, next) => {
    const userId = ctx.from?.id;

    if (!userId || !authService.isAuthorized(userId)) {
      await ctx.reply("🚫 Access denied");
      return;
    }

    await next();
  };
}
