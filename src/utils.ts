/**
 * Utility functions for Telegram Code Analyzer
 */
import { promises as fs } from "fs";
import { join } from "path";
import { z } from "zod";
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
  await fs.mkdir(dirPath, { recursive: true });
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
 * Zod schema for rate limiter configuration
 */
const RateLimiterConfigSchema = z.object({
  maxRequests: z.number().positive().default(RATE_LIMIT.MAX_REQUESTS_PER_MINUTE),
  windowMs: z.number().positive().default(RATE_LIMIT.WINDOW_SIZE_MS),
  cleanupIntervalMs: z.number().positive().default(RATE_LIMIT.CLEANUP_INTERVAL_MS),
});

/**
 * Zod schema for application configuration
 */
const ConfigSchema = z.object({
  telegramToken: z.string().min(1, "TELEGRAM_BOT_TOKEN is required"),
  authorizedUsers: z
    .array(z.number().positive())
    .min(1, "At least one authorized user required"),
  projectPath: z.string().min(1, "PROJECT_PATH is required"),
  claudeTimeout: z.number().positive().default(ANALYSIS.DEFAULT_TIMEOUT_MS),
  rateLimiter: RateLimiterConfigSchema,
});

/**
 * Parses environment variable as positive number with fallback
 */
function parseEnvNumber(value: string | undefined, defaultValue: number): number {
  if (!value) return defaultValue;
  const parsed = parseInt(value, 10);
  return isNaN(parsed) || parsed <= 0 ? defaultValue : parsed;
}

/**
 * Loads rate limiter configuration from environment variables
 */
function loadRateLimiterConfig(): RateLimiterConfig {
  return {
    maxRequests: parseEnvNumber(
      process.env.RATE_LIMIT_MAX_REQUESTS,
      RATE_LIMIT.MAX_REQUESTS_PER_MINUTE
    ),
    windowMs: parseEnvNumber(
      process.env.RATE_LIMIT_WINDOW_MS,
      RATE_LIMIT.WINDOW_SIZE_MS
    ),
    cleanupIntervalMs: parseEnvNumber(
      process.env.RATE_LIMIT_CLEANUP_INTERVAL_MS,
      RATE_LIMIT.CLEANUP_INTERVAL_MS
    ),
  };
}

/**
 * Loads configuration from environment variables with Zod validation
 */
export function loadConfig(): Config {
  const rawConfig = {
    telegramToken: process.env.TELEGRAM_BOT_TOKEN ?? "",
    authorizedUsers: (process.env.AUTHORIZED_USERS ?? "")
      .split(",")
      .map((id) => parseInt(id.trim(), 10))
      .filter((id) => !isNaN(id) && id > 0),
    projectPath: process.env.PROJECT_PATH ?? "",
    claudeTimeout: parseEnvNumber(
      process.env.CLAUDE_TIMEOUT,
      ANALYSIS.DEFAULT_TIMEOUT_MS
    ),
    rateLimiter: loadRateLimiterConfig(),
  };

  return ConfigSchema.parse(rawConfig);
}
