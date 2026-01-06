/**
 * Telegram bot for code analysis with RAG and multi-LLM support
 */

import { Bot, Context } from "grammy";
import {
  logger,
  loadExtendedConfig,
  getConfiguredProviders,
  getConfigValue,
  formatForTelegram,
  splitMessage,
} from "./utils.js";
import { validateUserMessage, sanitizeText } from "./validation.js";
import {
  isClaudeError,
  isValidationError,
  isLLMError,
  isRAGError,
  ClaudeErrorSubType,
} from "./errors/index.js";
import { createAuthService, authMiddleware } from "./auth.js";
import { RAGPipeline } from "./rag/index.js";
import {
  createCompletionProvider,
  getEmbeddingProvider,
  getAvailableProviders,
} from "./llm/index.js";
import type { ProviderFactoryConfig } from "./llm/types.js";
import type { ExtendedConfig } from "./types.js";

// =============================================================================
// Security: Error Message Sanitization
// =============================================================================

/**
 * Sanitize error messages to remove potential API keys
 * @param message - Error message that may contain sensitive data
 * @returns Sanitized message with API keys replaced by [REDACTED]
 */
export function sanitizeErrorMessage(message: string): string {
  return (
    message
      // OpenAI keys: sk-...
      .replace(/sk-[a-zA-Z0-9]{20,}/g, "[REDACTED]")
      // Google/Gemini keys: AIza...
      .replace(/AIza[a-zA-Z0-9_-]{35}/g, "[REDACTED]")
      // Anthropic keys: sk-ant-...
      .replace(/sk-ant-[a-zA-Z0-9-]{90,}/g, "[REDACTED]")
      // Perplexity keys: pplx-...
      .replace(/pplx-[a-zA-Z0-9]{40,}/g, "[REDACTED]")
      // Generic Bearer tokens
      .replace(/Bearer\s+[a-zA-Z0-9_-]{20,}/g, "Bearer [REDACTED]")
  );
}

// =============================================================================
// RAG Pipeline (shared instance)
// =============================================================================

/** Global RAG pipeline instance (exported for testing) */
export let ragPipeline: RAGPipeline | null = null;

/** Mutex flag to prevent concurrent indexing (exported for testing) */
export let indexingInProgress = false;

/** Reset indexing state (for testing) */
export function resetIndexingState(): void {
  indexingInProgress = false;
}

/** Set indexing in progress (for testing) */
export function setIndexingInProgress(value: boolean): void {
  indexingInProgress = value;
}

/** Reset RAG pipeline (for testing) */
export function resetRagPipeline(): void {
  ragPipeline = null;
}

/**
 * Ensures RAG pipeline is initialized and returns it
 * @param config - Extended configuration
 * @returns Initialized RAG pipeline
 */
export async function ensureRagPipeline(
  config: ExtendedConfig
): Promise<RAGPipeline> {
  if (!ragPipeline) {
    ragPipeline = new RAGPipeline(config.ragConfig);

    // Try to load existing index
    const loaded = await ragPipeline.loadIndex(config.ragStorePath);
    if (loaded) {
      logger.info(`Loaded existing RAG index: ${loaded.totalChunks} chunks`);
    }
  }
  return ragPipeline;
}

/**
 * Converts LLMApiKeys to ProviderFactoryConfig format
 * @param apiKeys - LLM API keys from extended config
 * @returns Factory config for LLM provider creation
 */
export function toProviderFactoryConfig(
  apiKeys: ExtendedConfig["llmApiKeys"]
): ProviderFactoryConfig {
  const config: {
    openaiApiKey?: string;
    geminiApiKey?: string;
    anthropicApiKey?: string;
    perplexityApiKey?: string;
    jinaApiKey?: string;
  } = {};

  if (apiKeys.openai) config.openaiApiKey = apiKeys.openai;
  if (apiKeys.gemini) config.geminiApiKey = apiKeys.gemini;
  if (apiKeys.anthropic) config.anthropicApiKey = apiKeys.anthropic;
  if (apiKeys.perplexity) config.perplexityApiKey = apiKeys.perplexity;
  if (apiKeys.jina) config.jinaApiKey = apiKeys.jina;

  return config;
}

// =============================================================================
// Bot Factory
// =============================================================================

export async function startSimpleAnimation(ctx: Context) {
  const message = await ctx.reply("⏳ Analyzing...");
  return message.message_id;
}

/**
 * Creates and configures the Telegram bot with all handlers
 * @returns Configured Bot instance
 */
export function createBot(): Bot {
  const config = loadExtendedConfig();
  const authService = createAuthService(config.authorizedUsers, config.adminUsers);

  const bot = new Bot(config.telegramToken);

  // Global error handler
  bot.catch(async (err) => {
    const error = err.error;

    if (isLLMError(error)) {
      await err.ctx
        .reply(sanitizeErrorMessage(error.userMessage))
        .catch((e) => logger.debug("Failed to send LLM error reply:", e));
    } else if (isRAGError(error)) {
      await err.ctx
        .reply(sanitizeErrorMessage(error.userMessage))
        .catch((e) => logger.debug("Failed to send RAG error reply:", e));
    } else if (isClaudeError(error)) {
      if (error.subType === ClaudeErrorSubType.TIMEOUT) {
        await err.ctx
          .reply("⏱️ Analysis timed out. Try a simpler question.")
          .catch((e) => logger.debug("Failed to send timeout reply:", e));
      } else {
        await err.ctx
          .reply(
            `❌ Analysis error: ${sanitizeErrorMessage(error.userMessage)}`
          )
          .catch((e) => logger.debug("Failed to send error reply:", e));
      }
    } else if (isValidationError(error)) {
      await err.ctx
        .reply(`⚠️ Invalid input: ${sanitizeErrorMessage(error.message)}`)
        .catch((e) => logger.debug("Failed to send validation reply:", e));
    } else {
      logger.error("Bot error:", sanitizeErrorMessage(String(error)));
      await err.ctx
        .reply("❌ Error occurred. Please try again later.")
        .catch((e) => logger.debug("Failed to send generic error reply:", e));
    }
  });

  // Apply auth middleware to all handlers
  bot.use(authMiddleware(authService));

  // /start command
  bot.command("start", async (ctx) => {
    const maxLength = getConfigValue("USERNAME_DISPLAY_LENGTH");
    const username = sanitizeText(ctx.from?.first_name || "user").substring(
      0,
      maxLength
    );
    await ctx.reply(
      `👋 Hello, ${username}!\n\n` +
        "🤖 Bot for code analysis using Claude Code CLI.\n\n" +
        "📝 Send your code question as a text message."
    );
  });

  // /help command
  bot.command("help", async (ctx) => {
    const availableProviders = getConfiguredProviders(config.llmApiKeys);
    await ctx.reply(
      "📖 <b>Usage Guide</b>\n\n" +
        "<b>Commands:</b>\n" +
        "/index - Index codebase for RAG\n" +
        "/ask &lt;question&gt; - Query codebase via RAG\n" +
        "/status - Show system status\n\n" +
        "<b>Text Analysis:</b>\n" +
        '🔍 Example: "Explain project architecture"\n' +
        "⚡ Send text message for Claude CLI analysis.\n\n" +
        `Available providers: ${availableProviders.join(", ") || "none"}`,
      { parse_mode: "HTML" }
    );
  });

  // ==========================================================================
  // /index command - Index codebase for RAG (admin only)
  // ==========================================================================
  bot.command("index", async (ctx) => {
    // Admin-only command
    const userId = ctx.from?.id;
    if (!userId || !authService.isAdmin(userId)) {
      await ctx.reply("🚫 Only admins can run indexing.");
      return;
    }

    // Prevent concurrent indexing operations
    if (indexingInProgress) {
      await ctx.reply("⏳ Indexing already in progress. Please wait.");
      return;
    }

    const factoryConfig = toProviderFactoryConfig(config.llmApiKeys);
    const availableProviders = getAvailableProviders(factoryConfig);

    // Check for embedding-capable provider
    const hasEmbeddingProvider = availableProviders.some(
      (p) => p === "openai" || p === "gemini" || p === "jina"
    );

    if (!hasEmbeddingProvider) {
      await ctx.reply(
        "❌ Indexing requires an embedding provider.\n" +
          "Configure JINA_API_KEY, OPENAI_API_KEY, or GEMINI_API_KEY."
      );
      return;
    }

    indexingInProgress = true;
    await ctx.reply("📚 Starting codebase indexing... This may take a while.");

    try {
      const pipeline = await ensureRagPipeline(config);
      const embeddingProvider = getEmbeddingProvider(
        factoryConfig,
        config.defaultEmbeddingProvider
      );

      const metadata = await pipeline.index(
        config.projectPath,
        embeddingProvider,
        config.ragStorePath
      );

      await ctx.reply(
        `✅ <b>Indexing complete!</b>\n\n` +
          `📊 ${metadata.totalChunks} chunks\n` +
          `📝 ${metadata.totalTokens} tokens\n` +
          `📁 Project: ${metadata.projectPath}`,
        { parse_mode: "HTML" }
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      logger.error("Indexing failed:", sanitizeErrorMessage(String(error)));
      await ctx.reply(`❌ Indexing failed: ${sanitizeErrorMessage(message)}`);
    } finally {
      indexingInProgress = false;
    }
  });

  // ==========================================================================
  // /ask command - Query codebase via RAG
  // ==========================================================================
  bot.command("ask", async (ctx) => {
    const rawQuestion = ctx.match?.toString().trim();
    if (!rawQuestion) {
      await ctx.reply("❌ Usage: /ask <your question about the code>");
      return;
    }

    // Validate the question like regular messages
    const validation = validateUserMessage(rawQuestion);
    if (!validation.success || !validation.data) {
      await ctx.reply(`❌ ${validation.error ?? "Invalid question"}`);
      return;
    }

    const question = sanitizeText(validation.data);

    const userId = ctx.from?.id;
    if (!userId) return;

    const factoryConfig = toProviderFactoryConfig(config.llmApiKeys);

    // Check for embedding-capable provider
    const availableProviders = getAvailableProviders(factoryConfig);
    const hasEmbeddingProvider = availableProviders.some(
      (p) => p === "openai" || p === "gemini" || p === "jina"
    );

    if (!hasEmbeddingProvider) {
      await ctx.reply(
        "❌ RAG queries require an embedding provider (Jina, OpenAI, or Gemini)."
      );
      return;
    }

    const pipeline = await ensureRagPipeline(config);
    const status = pipeline.getStatus();

    if (!status.indexed) {
      await ctx.reply("❌ Codebase not indexed. Use /index first.");
      return;
    }

    const animationId = await startSimpleAnimation(ctx);

    try {
      const embeddingProvider = getEmbeddingProvider(
        factoryConfig,
        config.defaultEmbeddingProvider
      );

      // Get API key for configured default provider
      const providerApiKey = config.llmApiKeys[config.defaultLLMProvider];
      if (!providerApiKey) {
        await ctx.api.deleteMessage(ctx.chat.id, animationId).catch(() => {});
        await ctx.reply(
          `❌ API key not configured for ${config.defaultLLMProvider}.`
        );
        return;
      }

      const completionProvider = createCompletionProvider(
        config.defaultLLMProvider,
        providerApiKey
      );

      const result = await pipeline.query(
        question,
        embeddingProvider,
        completionProvider
      );

      await ctx.api.deleteMessage(ctx.chat.id, animationId).catch(() => {});

      // Format sources
      const maxSources = getConfigValue("RAG_MAX_SOURCES_DISPLAY");
      const sources = result.sources
        .slice(0, maxSources)
        .map((s, i) => `[${i + 1}] ${s.chunk.filePath}:${s.chunk.startLine}`)
        .join("\n");

      // Convert LLM response to Telegram HTML format
      const formattedAnswer = formatForTelegram(result.answer);
      const fullMessage = `🔍 <b>Answer:</b>\n\n${formattedAnswer}`;

      // Split long messages and send
      const messageParts = splitMessage(fullMessage);
      for (const part of messageParts) {
        await ctx.reply(part, { parse_mode: "HTML" });
      }

      // Send sources separately if present
      if (sources) {
        await ctx.reply(`📚 <b>Sources:</b>\n${sources}`, { parse_mode: "HTML" });
      }
    } catch (error) {
      await ctx.api.deleteMessage(ctx.chat.id, animationId).catch(() => {});
      const message = error instanceof Error ? error.message : "Unknown error";
      logger.error("RAG query failed:", sanitizeErrorMessage(String(error)));
      await ctx.reply(`❌ Query failed: ${sanitizeErrorMessage(message)}`);
    }
  });

  // ==========================================================================
  // /status command - Show system status
  // ==========================================================================
  bot.command("status", async (ctx) => {
    const factoryConfig = toProviderFactoryConfig(config.llmApiKeys);
    const availableProviders = getAvailableProviders(factoryConfig);

    let ragStatus = "Not initialized";
    let lastIndexed = "";
    if (ragPipeline) {
      const status = ragPipeline.getStatus();
      if (status.indexed && status.metadata) {
        ragStatus = `✅ Indexed (${status.metadata.totalChunks} chunks)`;
        const indexedDate = new Date(status.metadata.indexedAt);
        lastIndexed = `\n📅 Last indexed: ${indexedDate.toLocaleString("ru-RU")}`;
      } else {
        ragStatus = "❌ Not indexed";
      }
    }

    await ctx.reply(
      `📊 <b>System Status</b>\n\n` +
        `🤖 LLM provider: ${config.defaultLLMProvider}\n` +
        `📚 RAG Index: ${ragStatus}${lastIndexed}\n` +
        `🔧 Available providers: ${availableProviders.join(", ") || "none"}\n` +
        `📁 Project: ${config.projectPath}`,
      { parse_mode: "HTML" }
    );
  });

  // Handler for text messages without commands - redirect to /ask
  bot.on("message:text", async (ctx) => {
    await ctx.reply(
      "💡 Use /ask command for code questions.\n\n" +
        "Example: `/ask How does authentication work?`"
    );
  });

  // Handler for non-text messages
  bot.on("message", async (ctx) => {
    await ctx.reply("❌ Only text messages supported.");
  });

  logger.debug("Bot created");
  return bot;
}
