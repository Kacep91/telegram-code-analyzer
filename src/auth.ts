import { Middleware, Context } from "grammy";
import { logger } from "./utils.js";

export interface AuthService {
  isAuthorized(userId: number): boolean;
}

export function createAuthService(authorizedUsers: number[]): AuthService {
  const usersSet = new Set(authorizedUsers);
  return {
    isAuthorized: (userId: number) => {
      const authorized = usersSet.has(userId);
      if (!authorized) {
        logger.warn("Unauthorized access attempt");
      }
      return authorized;
    },
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
