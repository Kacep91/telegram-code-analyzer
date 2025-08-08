/**
 * Utility functions for Telegram Code Analyzer
 */
import { promises as fs } from "fs";
import { join } from "path";
import { Config, RateLimiterConfig } from "./types.js";

const RATE_LIMIT = {
  MAX_REQUESTS_PER_MINUTE: 10,
  WINDOW_SIZE_MS: 60_000,
  CLEANUP_INTERVAL_MS: 300_000,
} as const;

const ANALYSIS = {
  DEFAULT_TIMEOUT_MS: 300_000,
  MAX_SUMMARY_LENGTH: 300,
  DEFAULT_OUTPUT_DIR: "temp",
} as const;

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

const LOG_LEVEL = (() => {
  const level = process.env.LOG_LEVEL?.toUpperCase() || "INFO";
  const isProduction = process.env.NODE_ENV === "production";

  if (isProduction && (level === "DEBUG" || level === "INFO")) {
    return LogLevel.WARN;
  }

  switch (level) {
    case "DEBUG":
      return LogLevel.DEBUG;
    case "INFO":
      return LogLevel.INFO;
    case "WARN":
      return LogLevel.WARN;
    case "ERROR":
      return LogLevel.ERROR;
    default:
      return LogLevel.INFO;
  }
})();

export const logger = {
  debug: (message: string, ...args: unknown[]) => {
    if (LOG_LEVEL <= LogLevel.DEBUG) {
      console.log(`🔍 ${message}`, ...args);
    }
  },

  info: (message: string, ...args: unknown[]) => {
    if (LOG_LEVEL <= LogLevel.INFO) {
      console.log(`ℹ️ ${message}`, ...args);
    }
  },

  warn: (message: string, ...args: unknown[]) => {
    if (LOG_LEVEL <= LogLevel.WARN) {
      console.warn(`⚠️ ${message}`, ...args);
    }
  },

  error: (message: string, ...args: unknown[]) => {
    if (LOG_LEVEL <= LogLevel.ERROR) {
      console.error(`❌ ${message}`, ...args);
    }
  },
};

/**
 * Creates directory if it doesn't exist
 */
export async function ensureDir(dirPath: string): Promise<void> {
  try {
    await fs.access(dirPath);
  } catch {
    await fs.mkdir(dirPath, { recursive: true });
  }
}

/**
 * Saves analysis result to .md file
 */
export async function saveAnalysis(
  question: string,
  content: string,
  outputDir: string = ANALYSIS.DEFAULT_OUTPUT_DIR
): Promise<string> {
  logger.debug(`Saving analysis to directory: ${outputDir}`);
  await ensureDir(outputDir);

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const questionSlug = question
    .replace(/[^a-zA-Z0-9\s]/g, "")
    .trim()
    .split(/\s+/)
    .slice(0, 5)
    .join("-")
    .toLowerCase();

  const fileName = `analysis-${questionSlug}-${timestamp}.md`;
  const filePath = join(outputDir, fileName);

  const fileContent = `# Code Analysis

**Question:** ${question}

**Date:** ${new Date().toLocaleString("en-US")}

---

${content}
`;

  await fs.writeFile(filePath, fileContent, "utf8");
  logger.info(`File saved: ${fileName} (${fileContent.length} characters)`);
  return filePath;
}

/**
 * Creates brief summary from content
 */
export function createSummary(
  content: string,
  maxLength: number = ANALYSIS.MAX_SUMMARY_LENGTH
): string {
  if (content.length <= maxLength) {
    return content;
  }

  const truncated = content.substring(0, maxLength);
  const lastSpaceIndex = truncated.lastIndexOf(" ");

  if (lastSpaceIndex === -1) {
    return truncated + "...";
  }

  return truncated.substring(0, lastSpaceIndex) + "...";
}

/**
 * Formats duration in milliseconds to readable format
 */
export function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);

  if (seconds < 60) {
    return `${seconds}s`;
  }

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;

  if (minutes < 60) {
    return remainingSeconds > 0
      ? `${minutes}m ${remainingSeconds}s`
      : `${minutes}m`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}

/**
 * Loads rate limiter configuration from environment variables
 */
function loadRateLimiterConfig(): RateLimiterConfig {
  const maxRequestsString = process.env.RATE_LIMIT_MAX_REQUESTS;
  const windowMsString = process.env.RATE_LIMIT_WINDOW_MS;
  const cleanupIntervalMsString = process.env.RATE_LIMIT_CLEANUP_INTERVAL_MS;

  const maxRequests = maxRequestsString
    ? parseInt(maxRequestsString, 10)
    : RATE_LIMIT.MAX_REQUESTS_PER_MINUTE;

  const windowMs = windowMsString
    ? parseInt(windowMsString, 10)
    : RATE_LIMIT.WINDOW_SIZE_MS;

  const cleanupIntervalMs = cleanupIntervalMsString
    ? parseInt(cleanupIntervalMsString, 10)
    : RATE_LIMIT.CLEANUP_INTERVAL_MS;

  if (isNaN(maxRequests) || maxRequests <= 0) {
    logger.warn(
      `Invalid RATE_LIMIT_MAX_REQUESTS: ${maxRequestsString}, using default: ${RATE_LIMIT.MAX_REQUESTS_PER_MINUTE}`
    );
    return {
      maxRequests: RATE_LIMIT.MAX_REQUESTS_PER_MINUTE,
      windowMs: windowMs,
      cleanupIntervalMs: cleanupIntervalMs,
    };
  }

  if (isNaN(windowMs) || windowMs <= 0) {
    logger.warn(
      `Invalid RATE_LIMIT_WINDOW_MS: ${windowMsString}, using default: ${RATE_LIMIT.WINDOW_SIZE_MS}`
    );
    return {
      maxRequests: maxRequests,
      windowMs: RATE_LIMIT.WINDOW_SIZE_MS,
      cleanupIntervalMs: cleanupIntervalMs,
    };
  }

  if (isNaN(cleanupIntervalMs) || cleanupIntervalMs <= 0) {
    logger.warn(
      `Invalid RATE_LIMIT_CLEANUP_INTERVAL_MS: ${cleanupIntervalMsString}, using default: ${RATE_LIMIT.CLEANUP_INTERVAL_MS}`
    );
    return {
      maxRequests: maxRequests,
      windowMs: windowMs,
      cleanupIntervalMs: RATE_LIMIT.CLEANUP_INTERVAL_MS,
    };
  }

  return {
    maxRequests,
    windowMs,
    cleanupIntervalMs,
  };
}

/**
 * Loads configuration from environment variables
 */
export function loadConfig(): Config {
  const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!telegramToken) {
    throw new Error("TELEGRAM_BOT_TOKEN environment variable is required");
  }

  const authorizedUsersString = process.env.AUTHORIZED_USERS;
  if (!authorizedUsersString) {
    throw new Error("AUTHORIZED_USERS environment variable is required");
  }

  const authorizedUsers = authorizedUsersString
    .split(",")
    .map((id) => parseInt(id.trim(), 10))
    .filter((id) => !isNaN(id) && id > 0);

  if (authorizedUsers.length === 0) {
    throw new Error("AUTHORIZED_USERS must contain at least one valid user ID");
  }

  const projectPath = process.env.PROJECT_PATH;
  if (!projectPath) {
    throw new Error("PROJECT_PATH environment variable is required");
  }

  const claudeTimeoutString =
    process.env.CLAUDE_TIMEOUT || ANALYSIS.DEFAULT_TIMEOUT_MS.toString();
  const claudeTimeout = parseInt(claudeTimeoutString, 10);
  if (isNaN(claudeTimeout) || claudeTimeout <= 0) {
    throw new Error("CLAUDE_TIMEOUT must be a positive number");
  }

  const rateLimiter = loadRateLimiterConfig();

  return {
    telegramToken,
    authorizedUsers,
    projectPath,
    claudeTimeout,
    rateLimiter,
  };
}
