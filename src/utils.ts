/**
 * Utility functions for Telegram Code Analyzer
 */
import { promises as fs } from "fs";
import { join } from "path";
import { z } from "zod";
import {
  Config,
  RateLimiterConfig,
  ExtendedConfig,
  LLMApiKeys,
} from "./types.js";
import { RAGConfigSchema } from "./rag/types.js";

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

const LLM = {
  DEFAULT_PROVIDER: "openai",
  DEFAULT_RAG_STORE_PATH: "./rag-index",
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
  maxRequests: z
    .number()
    .positive()
    .default(RATE_LIMIT.MAX_REQUESTS_PER_MINUTE),
  windowMs: z.number().positive().default(RATE_LIMIT.WINDOW_SIZE_MS),
  cleanupIntervalMs: z
    .number()
    .positive()
    .default(RATE_LIMIT.CLEANUP_INTERVAL_MS),
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
function parseEnvNumber(
  value: string | undefined,
  defaultValue: number
): number {
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

// =============================================================================
// Extended Configuration for Multi-LLM Support
// =============================================================================

/** Provider type for default LLM (excludes claude-code which is CLI-only) */
type DefaultLLMProvider = "openai" | "gemini" | "anthropic" | "perplexity";

/**
 * Zod schema for LLM API keys
 */
const LLMApiKeysSchema = z.object({
  openai: z.string().min(1).optional(),
  gemini: z.string().min(1).optional(),
  anthropic: z.string().min(1).optional(),
  perplexity: z.string().min(1).optional(),
  jina: z.string().min(1).optional(),
});

/**
 * Zod schema for extended configuration with API key validation
 * @remarks Validates that the default LLM provider has a corresponding API key
 */
const ExtendedConfigSchema = ConfigSchema.extend({
  llmApiKeys: LLMApiKeysSchema,
  defaultLLMProvider: z
    .enum(["openai", "gemini", "anthropic", "perplexity"])
    .default(LLM.DEFAULT_PROVIDER),
  ragStorePath: z.string().min(1).default(LLM.DEFAULT_RAG_STORE_PATH),
  ragConfig: RAGConfigSchema,
}).refine(
  (data) => {
    const keyMap: Record<string, string | undefined> = {
      openai: data.llmApiKeys.openai,
      gemini: data.llmApiKeys.gemini,
      anthropic: data.llmApiKeys.anthropic,
      perplexity: data.llmApiKeys.perplexity,
    };
    return keyMap[data.defaultLLMProvider] !== undefined;
  },
  {
    message:
      "API key required for default LLM provider. Set the corresponding API key environment variable.",
    path: ["defaultLLMProvider"],
  }
);

/**
 * Loads LLM API keys from environment variables
 * @returns Object with available API keys (keys only present if set)
 */
function loadLLMApiKeys(): LLMApiKeys {
  // Build mutable object then return as readonly
  const keys: {
    openai?: string;
    gemini?: string;
    anthropic?: string;
    perplexity?: string;
    jina?: string;
  } = {};

  const openai = process.env.OPENAI_API_KEY;
  if (openai) keys.openai = openai;

  const gemini = process.env.GEMINI_API_KEY;
  if (gemini) keys.gemini = gemini;

  const anthropic = process.env.ANTHROPIC_API_KEY;
  if (anthropic) keys.anthropic = anthropic;

  const perplexity = process.env.PERPLEXITY_API_KEY;
  if (perplexity) keys.perplexity = perplexity;

  const jina = process.env.JINA_API_KEY;
  if (jina) keys.jina = jina;

  return keys;
}

/**
 * Parses environment variable as float with fallback
 * @param value - Raw environment variable value
 * @param defaultValue - Default if value is invalid
 */
function parseEnvFloat(
  value: string | undefined,
  defaultValue: number
): number {
  if (!value) return defaultValue;
  const parsed = parseFloat(value);
  return isNaN(parsed) ? defaultValue : parsed;
}

/**
 * Loads extended configuration with LLM and RAG settings
 * @returns Validated extended configuration
 * @throws ZodError if configuration is invalid
 */
export function loadExtendedConfig(): ExtendedConfig {
  const baseConfig = loadConfig();

  const rawExtended = {
    ...baseConfig,
    llmApiKeys: loadLLMApiKeys(),
    defaultLLMProvider:
      process.env.DEFAULT_LLM_PROVIDER || LLM.DEFAULT_PROVIDER,
    ragStorePath: process.env.RAG_STORE_PATH || LLM.DEFAULT_RAG_STORE_PATH,
    ragConfig: {
      chunkSize: parseEnvNumber(process.env.RAG_CHUNK_SIZE, 300),
      chunkOverlap: parseEnvNumber(process.env.RAG_CHUNK_OVERLAP, 50),
      topK: parseEnvNumber(process.env.RAG_TOP_K, 15),
      rerankTopK: parseEnvNumber(process.env.RAG_RERANK_TOP_K, 5),
      vectorWeight: parseEnvFloat(process.env.RAG_VECTOR_WEIGHT, 0.3),
      llmWeight: parseEnvFloat(process.env.RAG_LLM_WEIGHT, 0.7),
    },
  };

  return ExtendedConfigSchema.parse(rawExtended);
}

/**
 * Returns list of LLM providers that have API keys configured
 * @param apiKeys - LLM API keys object
 * @returns Array of configured provider names
 */
export function getConfiguredProviders(
  apiKeys: LLMApiKeys
): DefaultLLMProvider[] {
  const providers: DefaultLLMProvider[] = [];

  if (apiKeys.openai) providers.push("openai");
  if (apiKeys.gemini) providers.push("gemini");
  if (apiKeys.anthropic) providers.push("anthropic");
  if (apiKeys.perplexity) providers.push("perplexity");

  return providers;
}
