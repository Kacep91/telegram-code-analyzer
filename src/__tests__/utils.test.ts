import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { promises as fs } from "fs";
import { ZodError } from "zod";

// Mock fs/promises before importing utils
vi.mock("fs", () => ({
  promises: {
    mkdir: vi.fn().mockResolvedValue(undefined),
    writeFile: vi.fn().mockResolvedValue(undefined),
  },
}));

// Store original env
const originalEnv = { ...process.env };

describe("utils.ts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset environment for each test
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.resetModules();
  });

  describe("createSummary", () => {
    it("should return original text if shorter than maxLength", async () => {
      const { createSummary } = await import("../utils.js");
      const shortText = "Hello world";
      const result = createSummary(shortText, 100);
      expect(result).toBe(shortText);
    });

    it("should truncate long text with ellipsis at word boundary", async () => {
      const { createSummary } = await import("../utils.js");
      const longText = "This is a very long text that should be truncated";
      const result = createSummary(longText, 20);
      // "This is a very long " = 20 chars, last space at position 19
      expect(result).toBe("This is a very long...");
      expect(result.endsWith("...")).toBe(true);
    });

    it("should handle text exactly at maxLength boundary", async () => {
      const { createSummary } = await import("../utils.js");
      const exactText = "Exact length";
      const result = createSummary(exactText, 12);
      expect(result).toBe("Exact length");
    });

    it("should handle empty text", async () => {
      const { createSummary } = await import("../utils.js");
      const result = createSummary("", 100);
      expect(result).toBe("");
    });

    it("should handle text without spaces by truncating at maxLength", async () => {
      const { createSummary } = await import("../utils.js");
      const noSpaces = "abcdefghijklmnopqrstuvwxyz";
      const result = createSummary(noSpaces, 10);
      expect(result).toBe("abcdefghij...");
    });

    it("should use default maxLength of 300", async () => {
      const { createSummary } = await import("../utils.js");
      const longText = "a".repeat(400);
      const result = createSummary(longText);
      // Should truncate at 300 + "..."
      expect(result.length).toBe(303);
    });
  });

  describe("formatDuration", () => {
    it("should format 0 milliseconds as 0s", async () => {
      const { formatDuration } = await import("../utils.js");
      expect(formatDuration(0)).toBe("0s");
    });

    it("should format 1 second correctly", async () => {
      const { formatDuration } = await import("../utils.js");
      expect(formatDuration(1000)).toBe("1s");
    });

    it("should format 59999ms as 59s (under 1 minute)", async () => {
      const { formatDuration } = await import("../utils.js");
      expect(formatDuration(59999)).toBe("59s");
    });

    it("should format 60000ms as 1m (exactly 1 minute)", async () => {
      const { formatDuration } = await import("../utils.js");
      expect(formatDuration(60000)).toBe("1m");
    });

    it("should format minutes with remaining seconds", async () => {
      const { formatDuration } = await import("../utils.js");
      expect(formatDuration(90000)).toBe("1m 30s");
    });

    it("should format exact minutes without seconds", async () => {
      const { formatDuration } = await import("../utils.js");
      expect(formatDuration(120000)).toBe("2m");
    });

    it("should format hours correctly", async () => {
      const { formatDuration } = await import("../utils.js");
      expect(formatDuration(3600000)).toBe("1h");
    });

    it("should format hours with remaining minutes", async () => {
      const { formatDuration } = await import("../utils.js");
      expect(formatDuration(5400000)).toBe("1h 30m");
    });

    it("should format multiple hours without minutes", async () => {
      const { formatDuration } = await import("../utils.js");
      expect(formatDuration(7200000)).toBe("2h");
    });
  });

  describe("logger", () => {
    it("should log debug messages with DEBUG level", async () => {
      process.env.LOG_LEVEL = "DEBUG";
      process.env.NODE_ENV = "development";
      vi.resetModules();

      const { logger } = await import("../utils.js");
      const consoleSpy = vi.spyOn(console, "log");

      logger.debug("test debug message");
      expect(consoleSpy).toHaveBeenCalled();
    });

    it("should log info messages with INFO level", async () => {
      process.env.LOG_LEVEL = "INFO";
      process.env.NODE_ENV = "development";
      vi.resetModules();

      const { logger } = await import("../utils.js");
      const consoleSpy = vi.spyOn(console, "log");

      logger.info("test info message");
      expect(consoleSpy).toHaveBeenCalled();
    });

    it("should log warn messages with WARN level", async () => {
      process.env.LOG_LEVEL = "WARN";
      process.env.NODE_ENV = "development";
      vi.resetModules();

      const { logger } = await import("../utils.js");
      const consoleSpy = vi.spyOn(console, "warn");

      logger.warn("test warn message");
      expect(consoleSpy).toHaveBeenCalled();
    });

    it("should log error messages with ERROR level", async () => {
      process.env.LOG_LEVEL = "ERROR";
      process.env.NODE_ENV = "development";
      vi.resetModules();

      const { logger } = await import("../utils.js");
      const consoleSpy = vi.spyOn(console, "error");

      logger.error("test error message");
      expect(consoleSpy).toHaveBeenCalled();
    });

    it("should suppress DEBUG in production mode", async () => {
      process.env.LOG_LEVEL = "DEBUG";
      process.env.NODE_ENV = "production";
      vi.resetModules();

      const { logger } = await import("../utils.js");
      const consoleSpy = vi.spyOn(console, "log");

      logger.debug("should not appear");
      expect(consoleSpy).not.toHaveBeenCalled();
    });

    it("should suppress INFO in production mode", async () => {
      process.env.LOG_LEVEL = "INFO";
      process.env.NODE_ENV = "production";
      vi.resetModules();

      const { logger } = await import("../utils.js");
      const consoleSpy = vi.spyOn(console, "log");

      logger.info("should not appear");
      expect(consoleSpy).not.toHaveBeenCalled();
    });

    it("should use INFO as default log level", async () => {
      delete process.env.LOG_LEVEL;
      process.env.NODE_ENV = "development";
      vi.resetModules();

      const { logger } = await import("../utils.js");
      const consoleSpy = vi.spyOn(console, "log");

      logger.info("default level message");
      expect(consoleSpy).toHaveBeenCalled();
    });

    it("should use INFO as default for unknown log level", async () => {
      process.env.LOG_LEVEL = "UNKNOWN_LEVEL";
      process.env.NODE_ENV = "development";
      vi.resetModules();

      const { logger } = await import("../utils.js");
      const consoleSpy = vi.spyOn(console, "log");

      logger.info("should appear with unknown level");
      expect(consoleSpy).toHaveBeenCalled();
    });

    it("should pass additional arguments to console methods", async () => {
      process.env.LOG_LEVEL = "DEBUG";
      process.env.NODE_ENV = "development";
      vi.resetModules();

      const { logger } = await import("../utils.js");
      const consoleSpy = vi.spyOn(console, "log");

      logger.debug("message", { extra: "data" }, 123);
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("message"),
        { extra: "data" },
        123
      );
    });

    it("should suppress debug when log level is INFO", async () => {
      process.env.LOG_LEVEL = "INFO";
      process.env.NODE_ENV = "development";
      vi.resetModules();

      const { logger } = await import("../utils.js");
      const consoleSpy = vi.spyOn(console, "log");

      logger.debug("should not appear");
      expect(consoleSpy).not.toHaveBeenCalled();
    });

    it("should suppress info and debug when log level is WARN", async () => {
      process.env.LOG_LEVEL = "WARN";
      process.env.NODE_ENV = "development";
      vi.resetModules();

      const { logger } = await import("../utils.js");
      const consoleLogSpy = vi.spyOn(console, "log");

      logger.debug("should not appear");
      logger.info("should not appear either");
      expect(consoleLogSpy).not.toHaveBeenCalled();
    });

    it("should suppress all except error when log level is ERROR", async () => {
      process.env.LOG_LEVEL = "ERROR";
      process.env.NODE_ENV = "development";
      vi.resetModules();

      const { logger } = await import("../utils.js");
      const consoleLogSpy = vi.spyOn(console, "log");
      const consoleWarnSpy = vi.spyOn(console, "warn");

      logger.debug("should not appear");
      logger.info("should not appear");
      logger.warn("should not appear");
      expect(consoleLogSpy).not.toHaveBeenCalled();
      expect(consoleWarnSpy).not.toHaveBeenCalled();
    });
  });

  describe("loadConfig", () => {
    it("should load valid configuration from environment variables", async () => {
      process.env.TELEGRAM_BOT_TOKEN = "test-token-12345";
      process.env.AUTHORIZED_USERS = "123,456,789";
      process.env.PROJECT_PATH = "/test/project";
      process.env.CLAUDE_TIMEOUT = "60000";
      vi.resetModules();

      const { loadConfig } = await import("../utils.js");
      const config = loadConfig();

      expect(config.telegramToken).toBe("test-token-12345");
      expect(config.authorizedUsers).toEqual([123, 456, 789]);
      expect(config.projectPath).toBe("/test/project");
      expect(config.claudeTimeout).toBe(60000);
    });

    it("should throw ZodError when TELEGRAM_BOT_TOKEN is missing", async () => {
      delete process.env.TELEGRAM_BOT_TOKEN;
      process.env.AUTHORIZED_USERS = "123";
      process.env.PROJECT_PATH = "/test";
      vi.resetModules();

      const { loadConfig } = await import("../utils.js");
      expect(() => loadConfig()).toThrow(ZodError);
    });

    it("should throw ZodError when AUTHORIZED_USERS is empty", async () => {
      process.env.TELEGRAM_BOT_TOKEN = "test-token";
      process.env.AUTHORIZED_USERS = "";
      process.env.PROJECT_PATH = "/test";
      vi.resetModules();

      const { loadConfig } = await import("../utils.js");
      expect(() => loadConfig()).toThrow(ZodError);
    });

    it("should throw ZodError when PROJECT_PATH is missing", async () => {
      process.env.TELEGRAM_BOT_TOKEN = "test-token";
      process.env.AUTHORIZED_USERS = "123";
      delete process.env.PROJECT_PATH;
      vi.resetModules();

      const { loadConfig } = await import("../utils.js");
      expect(() => loadConfig()).toThrow(ZodError);
    });

    it("should use default timeout when CLAUDE_TIMEOUT is not set", async () => {
      process.env.TELEGRAM_BOT_TOKEN = "test-token";
      process.env.AUTHORIZED_USERS = "123";
      process.env.PROJECT_PATH = "/test";
      delete process.env.CLAUDE_TIMEOUT;
      vi.resetModules();

      const { loadConfig } = await import("../utils.js");
      const config = loadConfig();
      expect(config.claudeTimeout).toBe(300000); // Default value
    });

    it("should parse rate limiter configuration from environment", async () => {
      process.env.TELEGRAM_BOT_TOKEN = "test-token";
      process.env.AUTHORIZED_USERS = "123";
      process.env.PROJECT_PATH = "/test";
      process.env.RATE_LIMIT_MAX_REQUESTS = "20";
      process.env.RATE_LIMIT_WINDOW_MS = "30000";
      vi.resetModules();

      const { loadConfig } = await import("../utils.js");
      const config = loadConfig();

      expect(config.rateLimiter.maxRequests).toBe(20);
      expect(config.rateLimiter.windowMs).toBe(30000);
    });

    it("should filter out invalid user IDs from AUTHORIZED_USERS", async () => {
      process.env.TELEGRAM_BOT_TOKEN = "test-token";
      process.env.AUTHORIZED_USERS = "123,invalid,456,-1,0";
      process.env.PROJECT_PATH = "/test";
      vi.resetModules();

      const { loadConfig } = await import("../utils.js");
      const config = loadConfig();
      expect(config.authorizedUsers).toEqual([123, 456]);
    });

    it("should use default for invalid CLAUDE_TIMEOUT values", async () => {
      process.env.TELEGRAM_BOT_TOKEN = "test-token";
      process.env.AUTHORIZED_USERS = "123";
      process.env.PROJECT_PATH = "/test";
      process.env.CLAUDE_TIMEOUT = "invalid";
      vi.resetModules();

      const { loadConfig } = await import("../utils.js");
      const config = loadConfig();
      expect(config.claudeTimeout).toBe(300000);
    });

    it("should use default for negative CLAUDE_TIMEOUT values", async () => {
      process.env.TELEGRAM_BOT_TOKEN = "test-token";
      process.env.AUTHORIZED_USERS = "123";
      process.env.PROJECT_PATH = "/test";
      process.env.CLAUDE_TIMEOUT = "-1000";
      vi.resetModules();

      const { loadConfig } = await import("../utils.js");
      const config = loadConfig();
      expect(config.claudeTimeout).toBe(300000);
    });

    it("should use default for zero CLAUDE_TIMEOUT value", async () => {
      process.env.TELEGRAM_BOT_TOKEN = "test-token";
      process.env.AUTHORIZED_USERS = "123";
      process.env.PROJECT_PATH = "/test";
      process.env.CLAUDE_TIMEOUT = "0";
      vi.resetModules();

      const { loadConfig } = await import("../utils.js");
      const config = loadConfig();
      expect(config.claudeTimeout).toBe(300000);
    });

    it("should parse rate limiter cleanup interval from environment", async () => {
      process.env.TELEGRAM_BOT_TOKEN = "test-token";
      process.env.AUTHORIZED_USERS = "123";
      process.env.PROJECT_PATH = "/test";
      process.env.RATE_LIMIT_CLEANUP_INTERVAL_MS = "600000";
      vi.resetModules();

      const { loadConfig } = await import("../utils.js");
      const config = loadConfig();

      expect(config.rateLimiter.cleanupIntervalMs).toBe(600000);
    });

    it("should use default values for invalid rate limiter env vars", async () => {
      process.env.TELEGRAM_BOT_TOKEN = "test-token";
      process.env.AUTHORIZED_USERS = "123";
      process.env.PROJECT_PATH = "/test";
      process.env.RATE_LIMIT_MAX_REQUESTS = "invalid";
      process.env.RATE_LIMIT_WINDOW_MS = "not-a-number";
      process.env.RATE_LIMIT_CLEANUP_INTERVAL_MS = "abc";
      vi.resetModules();

      const { loadConfig } = await import("../utils.js");
      const config = loadConfig();

      expect(config.rateLimiter.maxRequests).toBe(10);
      expect(config.rateLimiter.windowMs).toBe(60000);
      expect(config.rateLimiter.cleanupIntervalMs).toBe(300000);
    });

    it("should use default values for zero rate limiter env vars", async () => {
      process.env.TELEGRAM_BOT_TOKEN = "test-token";
      process.env.AUTHORIZED_USERS = "123";
      process.env.PROJECT_PATH = "/test";
      process.env.RATE_LIMIT_MAX_REQUESTS = "0";
      process.env.RATE_LIMIT_WINDOW_MS = "-100";
      vi.resetModules();

      const { loadConfig } = await import("../utils.js");
      const config = loadConfig();

      expect(config.rateLimiter.maxRequests).toBe(10);
      expect(config.rateLimiter.windowMs).toBe(60000);
    });
  });

  describe("loadExtendedConfig", () => {
    beforeEach(() => {
      // Base config required for all extended config tests
      process.env.TELEGRAM_BOT_TOKEN = "test-token";
      process.env.AUTHORIZED_USERS = "123";
      process.env.PROJECT_PATH = "/test";
    });

    it("should load extended configuration with API keys", async () => {
      process.env.OPENAI_API_KEY = "sk-openai-key";
      process.env.DEFAULT_LLM_PROVIDER = "openai";
      vi.resetModules();

      const { loadExtendedConfig } = await import("../utils.js");
      const config = loadExtendedConfig();

      expect(config.llmApiKeys.openai).toBe("sk-openai-key");
      expect(config.defaultLLMProvider).toBe("openai");
    });

    it("should throw when default provider has no API key", async () => {
      process.env.DEFAULT_LLM_PROVIDER = "anthropic";
      delete process.env.ANTHROPIC_API_KEY;
      vi.resetModules();

      const { loadExtendedConfig } = await import("../utils.js");
      expect(() => loadExtendedConfig()).toThrow(ZodError);
    });

    it("should load RAG configuration from environment", async () => {
      process.env.OPENAI_API_KEY = "sk-test";
      process.env.DEFAULT_LLM_PROVIDER = "openai";
      process.env.RAG_CHUNK_SIZE = "500";
      process.env.RAG_TOP_K = "20";
      process.env.RAG_VECTOR_WEIGHT = "0.4";
      process.env.RAG_LLM_WEIGHT = "0.6";
      vi.resetModules();

      const { loadExtendedConfig } = await import("../utils.js");
      const config = loadExtendedConfig();

      expect(config.ragConfig.chunkSize).toBe(500);
      expect(config.ragConfig.topK).toBe(20);
      expect(config.ragConfig.vectorWeight).toBe(0.4);
      expect(config.ragConfig.llmWeight).toBe(0.6);
    });

    it("should use default RAG store path when not configured", async () => {
      process.env.OPENAI_API_KEY = "sk-test";
      process.env.DEFAULT_LLM_PROVIDER = "openai";
      delete process.env.RAG_STORE_PATH;
      vi.resetModules();

      const { loadExtendedConfig } = await import("../utils.js");
      const config = loadExtendedConfig();

      expect(config.ragStorePath).toBe("./rag-index");
    });

    it("should load all available API keys", async () => {
      process.env.OPENAI_API_KEY = "sk-openai";
      process.env.GEMINI_API_KEY = "gemini-key";
      process.env.ANTHROPIC_API_KEY = "anthropic-key";
      process.env.PERPLEXITY_API_KEY = "perplexity-key";
      process.env.DEFAULT_LLM_PROVIDER = "openai";
      vi.resetModules();

      const { loadExtendedConfig } = await import("../utils.js");
      const config = loadExtendedConfig();

      expect(config.llmApiKeys.openai).toBe("sk-openai");
      expect(config.llmApiKeys.gemini).toBe("gemini-key");
      expect(config.llmApiKeys.anthropic).toBe("anthropic-key");
      expect(config.llmApiKeys.perplexity).toBe("perplexity-key");
    });

    it("should load JINA API key when configured", async () => {
      process.env.OPENAI_API_KEY = "sk-openai";
      process.env.JINA_API_KEY = "jina-key";
      process.env.DEFAULT_LLM_PROVIDER = "openai";
      vi.resetModules();

      const { loadExtendedConfig } = await import("../utils.js");
      const config = loadExtendedConfig();

      expect(config.llmApiKeys.jina).toBe("jina-key");
    });

    it("should use default values for RAG config when env vars are not set", async () => {
      process.env.OPENAI_API_KEY = "sk-test";
      process.env.DEFAULT_LLM_PROVIDER = "openai";
      delete process.env.RAG_CHUNK_SIZE;
      delete process.env.RAG_CHUNK_OVERLAP;
      delete process.env.RAG_TOP_K;
      delete process.env.RAG_RERANK_TOP_K;
      delete process.env.RAG_VECTOR_WEIGHT;
      delete process.env.RAG_LLM_WEIGHT;
      vi.resetModules();

      const { loadExtendedConfig } = await import("../utils.js");
      const config = loadExtendedConfig();

      expect(config.ragConfig.chunkSize).toBe(300);
      expect(config.ragConfig.chunkOverlap).toBe(50);
      expect(config.ragConfig.topK).toBe(15);
      expect(config.ragConfig.rerankTopK).toBe(5);
      expect(config.ragConfig.vectorWeight).toBe(0.3);
      expect(config.ragConfig.llmWeight).toBe(0.7);
    });

    it("should load RAG_CHUNK_OVERLAP and RAG_RERANK_TOP_K from environment", async () => {
      process.env.OPENAI_API_KEY = "sk-test";
      process.env.DEFAULT_LLM_PROVIDER = "openai";
      process.env.RAG_CHUNK_OVERLAP = "100";
      process.env.RAG_RERANK_TOP_K = "10";
      vi.resetModules();

      const { loadExtendedConfig } = await import("../utils.js");
      const config = loadExtendedConfig();

      expect(config.ragConfig.chunkOverlap).toBe(100);
      expect(config.ragConfig.rerankTopK).toBe(10);
    });

    it("should use default for invalid float env values", async () => {
      process.env.OPENAI_API_KEY = "sk-test";
      process.env.DEFAULT_LLM_PROVIDER = "openai";
      process.env.RAG_VECTOR_WEIGHT = "invalid";
      process.env.RAG_LLM_WEIGHT = "not-a-number";
      vi.resetModules();

      const { loadExtendedConfig } = await import("../utils.js");
      const config = loadExtendedConfig();

      expect(config.ragConfig.vectorWeight).toBe(0.3);
      expect(config.ragConfig.llmWeight).toBe(0.7);
    });

    it("should use custom RAG_STORE_PATH when configured", async () => {
      process.env.OPENAI_API_KEY = "sk-test";
      process.env.DEFAULT_LLM_PROVIDER = "openai";
      process.env.RAG_STORE_PATH = "/custom/rag/path";
      vi.resetModules();

      const { loadExtendedConfig } = await import("../utils.js");
      const config = loadExtendedConfig();

      expect(config.ragStorePath).toBe("/custom/rag/path");
    });

    it("should work with gemini as default provider", async () => {
      process.env.GEMINI_API_KEY = "gemini-key";
      process.env.DEFAULT_LLM_PROVIDER = "gemini";
      vi.resetModules();

      const { loadExtendedConfig } = await import("../utils.js");
      const config = loadExtendedConfig();

      expect(config.defaultLLMProvider).toBe("gemini");
      expect(config.llmApiKeys.gemini).toBe("gemini-key");
    });

    it("should work with anthropic as default provider", async () => {
      process.env.ANTHROPIC_API_KEY = "anthropic-key";
      process.env.DEFAULT_LLM_PROVIDER = "anthropic";
      vi.resetModules();

      const { loadExtendedConfig } = await import("../utils.js");
      const config = loadExtendedConfig();

      expect(config.defaultLLMProvider).toBe("anthropic");
      expect(config.llmApiKeys.anthropic).toBe("anthropic-key");
    });

    it("should work with perplexity as default provider", async () => {
      process.env.PERPLEXITY_API_KEY = "perplexity-key";
      process.env.DEFAULT_LLM_PROVIDER = "perplexity";
      vi.resetModules();

      const { loadExtendedConfig } = await import("../utils.js");
      const config = loadExtendedConfig();

      expect(config.defaultLLMProvider).toBe("perplexity");
      expect(config.llmApiKeys.perplexity).toBe("perplexity-key");
    });

    it("should use openai as default provider when not specified", async () => {
      process.env.OPENAI_API_KEY = "sk-test";
      delete process.env.DEFAULT_LLM_PROVIDER;
      vi.resetModules();

      const { loadExtendedConfig } = await import("../utils.js");
      const config = loadExtendedConfig();

      expect(config.defaultLLMProvider).toBe("openai");
    });
  });

  describe("getConfiguredProviders", () => {
    it("should return empty array when no API keys configured", async () => {
      const { getConfiguredProviders } = await import("../utils.js");
      const providers = getConfiguredProviders({});
      expect(providers).toEqual([]);
    });

    it("should return only openai when only openai key is set", async () => {
      const { getConfiguredProviders } = await import("../utils.js");
      const providers = getConfiguredProviders({ openai: "sk-test" });
      expect(providers).toEqual(["openai"]);
    });

    it("should return only gemini when only gemini key is set", async () => {
      const { getConfiguredProviders } = await import("../utils.js");
      const providers = getConfiguredProviders({ gemini: "gemini-test" });
      expect(providers).toEqual(["gemini"]);
    });

    it("should return all providers when all keys are set", async () => {
      const { getConfiguredProviders } = await import("../utils.js");
      const providers = getConfiguredProviders({
        openai: "sk-openai",
        gemini: "gemini-key",
        anthropic: "anthropic-key",
        perplexity: "perplexity-key",
      });
      expect(providers).toEqual([
        "openai",
        "gemini",
        "anthropic",
        "perplexity",
      ]);
    });

    it("should return subset of providers based on available keys", async () => {
      const { getConfiguredProviders } = await import("../utils.js");
      const providers = getConfiguredProviders({
        openai: "sk-openai",
        anthropic: "anthropic-key",
      });
      expect(providers).toEqual(["openai", "anthropic"]);
    });
  });

  describe("ensureDir", () => {
    it("should create directory with recursive option", async () => {
      const { ensureDir } = await import("../utils.js");
      const mockMkdir = vi.mocked(fs.mkdir);

      await ensureDir("/test/path/to/dir");

      expect(mockMkdir).toHaveBeenCalledWith("/test/path/to/dir", {
        recursive: true,
      });
    });

    it("should resolve successfully when directory is created", async () => {
      const { ensureDir } = await import("../utils.js");

      await expect(ensureDir("/any/path")).resolves.toBeUndefined();
    });

    it("should handle mkdir failure gracefully", async () => {
      const mockMkdir = vi.mocked(fs.mkdir);
      mockMkdir.mockRejectedValueOnce(new Error("Permission denied"));

      const { ensureDir } = await import("../utils.js");

      await expect(ensureDir("/protected/path")).rejects.toThrow(
        "Permission denied"
      );
    });
  });

  describe("LogLevel enum", () => {
    it("should have correct numeric values", async () => {
      const { LogLevel } = await import("../utils.js");

      expect(LogLevel.DEBUG).toBe(0);
      expect(LogLevel.INFO).toBe(1);
      expect(LogLevel.WARN).toBe(2);
      expect(LogLevel.ERROR).toBe(3);
    });
  });

  describe("saveAnalysis", () => {
    beforeEach(() => {
      vi.clearAllMocks();
      // Reset module to ensure fresh import
      vi.resetModules();
    });

    it("should create directory if not exists", async () => {
      const { saveAnalysis } = await import("../utils.js");
      const mockMkdir = vi.mocked(fs.mkdir);

      await saveAnalysis("test question", "test content", "/custom/output");

      expect(mockMkdir).toHaveBeenCalledWith("/custom/output", {
        recursive: true,
      });
    });

    it("should generate filename from question", async () => {
      const { saveAnalysis } = await import("../utils.js");
      const mockWriteFile = vi.mocked(fs.writeFile);

      await saveAnalysis("What is the project structure", "content");

      expect(mockWriteFile).toHaveBeenCalled();
      const [filePath] = mockWriteFile.mock.calls[0] as [
        string,
        string,
        string,
      ];
      expect(filePath).toMatch(/analysis-what-is-the-project-structure-/);
      expect(filePath).toMatch(/\.md$/);
    });

    it("should handle special characters in filename", async () => {
      const { saveAnalysis } = await import("../utils.js");
      const mockWriteFile = vi.mocked(fs.writeFile);

      await saveAnalysis("What's the @#$% API endpoint?!", "content", "temp");

      expect(mockWriteFile).toHaveBeenCalled();
      const [filePath] = mockWriteFile.mock.calls[0] as [
        string,
        string,
        string,
      ];
      // Special characters should be removed
      expect(filePath).toMatch(/analysis-whats-the-api-endpoint-/);
      expect(filePath).not.toMatch(/[@#$%?!]/);
    });

    it("should truncate long questions in filename", async () => {
      const { saveAnalysis } = await import("../utils.js");
      const mockWriteFile = vi.mocked(fs.writeFile);

      const longQuestion =
        "word1 word2 word3 word4 word5 word6 word7 word8 word9 word10";
      await saveAnalysis(longQuestion, "content", "temp");

      expect(mockWriteFile).toHaveBeenCalled();
      const [filePath] = mockWriteFile.mock.calls[0] as [
        string,
        string,
        string,
      ];
      // Should only contain first 5 words
      expect(filePath).toMatch(/analysis-word1-word2-word3-word4-word5-/);
      expect(filePath).not.toContain("word6");
    });

    it("should write file with correct header", async () => {
      const { saveAnalysis } = await import("../utils.js");
      const mockWriteFile = vi.mocked(fs.writeFile);

      const question = "How does auth work";
      const content = "Authentication uses JWT tokens";

      await saveAnalysis(question, content, "temp");

      expect(mockWriteFile).toHaveBeenCalled();
      const [, fileContent] = mockWriteFile.mock.calls[0] as [
        string,
        string,
        string,
      ];

      expect(fileContent).toContain("# Code Analysis");
      expect(fileContent).toContain("**Question:** How does auth work");
      expect(fileContent).toContain("**Date:**");
      expect(fileContent).toContain("---");
      expect(fileContent).toContain("Authentication uses JWT tokens");
    });

    it("should return absolute file path", async () => {
      const { saveAnalysis } = await import("../utils.js");

      const result = await saveAnalysis("test question", "content", "temp");

      // Should return path containing the output directory
      expect(result).toContain("temp");
      expect(result).toMatch(/analysis-.*\.md$/);
    });

    it("should use default output directory when not specified", async () => {
      const { saveAnalysis } = await import("../utils.js");
      const mockMkdir = vi.mocked(fs.mkdir);

      await saveAnalysis("test", "content");

      expect(mockMkdir).toHaveBeenCalledWith("temp", { recursive: true });
    });

    it("should include timestamp in filename", async () => {
      const { saveAnalysis } = await import("../utils.js");
      const mockWriteFile = vi.mocked(fs.writeFile);

      await saveAnalysis("test", "content", "temp");

      expect(mockWriteFile).toHaveBeenCalled();
      const [filePath] = mockWriteFile.mock.calls[0] as [
        string,
        string,
        string,
      ];
      // Timestamp format: YYYY-MM-DDTHH-MM-SS-sssZ (with dashes instead of colons/dots)
      expect(filePath).toMatch(
        /\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.md$/
      );
    });

    it("should handle empty question gracefully", async () => {
      const { saveAnalysis } = await import("../utils.js");
      const mockWriteFile = vi.mocked(fs.writeFile);

      await saveAnalysis("", "content", "temp");

      expect(mockWriteFile).toHaveBeenCalled();
      const [filePath] = mockWriteFile.mock.calls[0] as [
        string,
        string,
        string,
      ];
      // Empty question should result in just timestamp
      expect(filePath).toMatch(/analysis--\d{4}/);
    });

    it("should write file with utf8 encoding", async () => {
      const { saveAnalysis } = await import("../utils.js");
      const mockWriteFile = vi.mocked(fs.writeFile);

      await saveAnalysis("test", "content", "temp");

      expect(mockWriteFile).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        "utf8"
      );
    });
  });
});
