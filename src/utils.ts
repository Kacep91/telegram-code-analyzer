/**
 * Utility functions for Telegram Code Analyzer
 */
import { promises as fs } from "fs";
import { join } from "path";
import { spawn } from "child_process";
import { z } from "zod";
import {
  Config,
  RateLimiterConfig,
  ExtendedConfig,
  LLMApiKeys,
} from "./types.js";
import { RAGConfigSchema } from "./rag/types.js";

const ANALYSIS = {
  DEFAULT_TIMEOUT_MS: 300_000,
} as const;

const LLM = {
  DEFAULT_PROVIDER: "openai",
  DEFAULT_EMBEDDING_PROVIDER: "jina",
  DEFAULT_RAG_STORE_PATH: "./rag-index",
} as const;

// =============================================================================
// Centralized Configuration Defaults
// =============================================================================

/**
 * Default values for all configurable parameters.
 * Can be overridden via environment variables.
 */
const DEFAULTS = {
  // Rate limiting
  RATE_LIMIT_MAX_REQUESTS: 10,
  RATE_LIMIT_WINDOW_MS: 60_000,
  RATE_LIMIT_CLEANUP_INTERVAL_MS: 300_000,

  // Analysis
  MAX_SUMMARY_LENGTH: 300,
  OUTPUT_DIR: "temp",

  // Validation
  VALIDATION_MESSAGE_MIN_LENGTH: 5,
  VALIDATION_MESSAGE_MAX_LENGTH: 2000,
  VALIDATION_USERNAME_MAX_LENGTH: 100,
  RATE_LIMITER_MAX_TRACKED_USERS: 10_000,

  // Display
  USERNAME_DISPLAY_LENGTH: 50,
  RAG_MAX_SOURCES_DISPLAY: 3,

  // Claude CLI
  CLAUDE_AVAILABILITY_CHECK_TIMEOUT: 5_000,

  // RAG
  TOKENS_CHARS_RATIO: 4,
  RAG_MAX_DIRECTORY_DEPTH: 20,
  RAG_EMBEDDING_BATCH_SIZE: 10,
} as const;

export type ConfigKey = keyof typeof DEFAULTS;

/**
 * Gets configuration value with environment variable override.
 * Falls back to default if env var not set or invalid.
 * @param key - Configuration key from DEFAULTS
 * @returns Configuration value (from env or default)
 */
export function getConfigValue<K extends ConfigKey>(key: K): (typeof DEFAULTS)[K] {
  const envValue = process.env[key];
  if (envValue === undefined) return DEFAULTS[key];

  const defaultValue = DEFAULTS[key];
  if (typeof defaultValue === "number") {
    const parsed = parseInt(envValue, 10);
    // Return default for NaN or non-positive values when default is positive
    if (isNaN(parsed) || (defaultValue > 0 && parsed <= 0)) {
      return defaultValue;
    }
    return parsed as (typeof DEFAULTS)[K];
  }
  return envValue as (typeof DEFAULTS)[K];
}

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
  outputDir: string = getConfigValue("OUTPUT_DIR")
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
  maxLength: number = getConfigValue("MAX_SUMMARY_LENGTH")
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
    .default(DEFAULTS.RATE_LIMIT_MAX_REQUESTS),
  windowMs: z.number().positive().default(DEFAULTS.RATE_LIMIT_WINDOW_MS),
  cleanupIntervalMs: z
    .number()
    .positive()
    .default(DEFAULTS.RATE_LIMIT_CLEANUP_INTERVAL_MS),
});

/**
 * Zod schema for application configuration
 */
const ConfigSchema = z.object({
  telegramToken: z.string().min(1, "TELEGRAM_BOT_TOKEN is required"),
  authorizedUsers: z
    .array(z.number().positive())
    .min(1, "At least one authorized user required"),
  adminUsers: z.array(z.number().positive()).default([]),
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
    maxRequests: getConfigValue("RATE_LIMIT_MAX_REQUESTS"),
    windowMs: getConfigValue("RATE_LIMIT_WINDOW_MS"),
    cleanupIntervalMs: getConfigValue("RATE_LIMIT_CLEANUP_INTERVAL_MS"),
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
    adminUsers: (process.env.ADMIN_USERS ?? "")
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
  defaultEmbeddingProvider: z
    .enum(["openai", "gemini", "jina"])
    .default(LLM.DEFAULT_EMBEDDING_PROVIDER),
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
    defaultEmbeddingProvider:
      process.env.DEFAULT_EMBEDDING_PROVIDER || LLM.DEFAULT_EMBEDDING_PROVIDER,
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

// =============================================================================
// Git Operations (using spawn for security)
// =============================================================================

const GIT_TIMEOUT_MS = 30_000;

interface GitCommandResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

/**
 * Execute git command safely using spawn
 * @param args - Git command arguments
 * @param cwd - Working directory
 * @param timeout - Timeout in ms (default 30s)
 */
export function executeGitCommand(
  args: readonly string[],
  cwd: string,
  timeout: number = GIT_TIMEOUT_MS
): Promise<GitCommandResult> {
  return new Promise((resolve, reject) => {
    const proc = spawn("git", [...args], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let finished = false;

    const timer = setTimeout(() => {
      if (!finished) {
        finished = true;
        proc.kill("SIGTERM");
        reject(new Error(`Git command timeout after ${timeout}ms`));
      }
    }, timeout);

    proc.stdout?.on("data", (data: Buffer) => {
      stdout += data.toString();
    });

    proc.stderr?.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      if (!finished) {
        finished = true;
        clearTimeout(timer);
        resolve({ stdout, stderr, exitCode: code ?? 1 });
      }
    });

    proc.on("error", (error) => {
      if (!finished) {
        finished = true;
        clearTimeout(timer);
        reject(new Error(`Git spawn failed: ${error.message}`));
      }
    });
  });
}

/**
 * Get last commit date from git repository
 * @param projectPath - Path to git repository
 * @returns ISO date string or null if failed
 */
export async function getLastCommitDate(
  projectPath: string
): Promise<string | null> {
  try {
    const result = await executeGitCommand(
      ["log", "-1", "--format=%cI"],
      projectPath
    );

    if (result.exitCode === 0 && result.stdout.trim()) {
      return result.stdout.trim();
    }
    return null;
  } catch (error) {
    logger.warn(
      `Failed to get last commit date: ${error instanceof Error ? error.message : String(error)}`
    );
    return null;
  }
}

/**
 * Execute git pull
 * @param projectPath - Path to git repository
 * @returns true if successful
 */
export async function gitPull(projectPath: string): Promise<boolean> {
  try {
    const result = await executeGitCommand(["pull"], projectPath);

    if (result.exitCode === 0) {
      logger.info("Git pull successful");
      return true;
    }

    logger.warn(`Git pull failed with exit code ${result.exitCode}: ${result.stderr}`);
    return false;
  } catch (error) {
    logger.warn(
      `Git pull failed: ${error instanceof Error ? error.message : String(error)}`
    );
    return false;
  }
}

// =============================================================================
// Telegram Formatting
// =============================================================================

const TELEGRAM_MESSAGE_LIMIT = 4000;

/**
 * Converts Markdown text to Telegram HTML format.
 * Handles: **bold**, *italic*, `code`, ### headers
 * @param text - Markdown text from LLM
 * @returns HTML-formatted text for Telegram
 */
export function formatForTelegram(text: string): string {
  // 1. Escape HTML entities first
  let result = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  // 2. Convert Markdown to HTML
  result = result
    // **bold** → <b>bold</b>
    .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
    // *italic* → <i>italic</i> (must be after bold)
    .replace(/\*(.+?)\*/g, "<i>$1</i>")
    // `code` → <code>code</code>
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    // ### Header → <b>Header</b>
    .replace(/^#{1,6}\s+(.+)$/gm, "<b>$1</b>");

  return result;
}

/**
 * Splits long message into chunks respecting Telegram's 4096 char limit.
 * Tries to split at paragraph boundaries, then line breaks, then spaces.
 * @param text - Text to split
 * @param maxLength - Maximum chunk length (default 4000 for safety margin)
 * @returns Array of message chunks
 */
export function splitMessage(
  text: string,
  maxLength: number = TELEGRAM_MESSAGE_LIMIT
): string[] {
  if (text.length <= maxLength) return [text];

  const parts: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      parts.push(remaining);
      break;
    }

    // Find best split point: paragraph break > line break > space
    let splitIndex = remaining.lastIndexOf("\n\n", maxLength);
    if (splitIndex === -1 || splitIndex < maxLength / 2) {
      splitIndex = remaining.lastIndexOf("\n", maxLength);
    }
    if (splitIndex === -1 || splitIndex < maxLength / 2) {
      splitIndex = remaining.lastIndexOf(" ", maxLength);
    }
    if (splitIndex === -1) {
      splitIndex = maxLength;
    }

    parts.push(remaining.substring(0, splitIndex).trim());
    remaining = remaining.substring(splitIndex).trim();
  }

  return parts;
}
