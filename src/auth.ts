import { Middleware, Context } from "grammy";

const AUTHORIZED_USERS = new Set(
  (process.env.AUTHORIZED_USERS || "").split(",").map(Number).filter(Boolean)
);

export interface AuthService {
  isAuthorized(userId: number): boolean;
}

export function isAuthorized(userId: number): boolean {
  const authorized = AUTHORIZED_USERS.has(userId);
  if (!authorized) {
    console.log(`❌ Unauthorized access: ${userId}`);
  }
  return authorized;
}

export function createAuthService(_authorizedUsers: number[]): AuthService {
  return { isAuthorized };
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
