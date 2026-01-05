/**
 * Telegram bot for code analysis with RAG and multi-LLM support
 */

import { Bot, Context, InputFile } from "grammy";
import { readFile } from "fs/promises";
import { executeClaudeAnalysis } from "./claude.js";
import {
  createSummary,
  formatDuration,
  logger,
  loadExtendedConfig,
  getConfiguredProviders,
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
import type { LLMProviderType, ProviderFactoryConfig } from "./llm/types.js";
import type { ExtendedConfig, UserPreferences } from "./types.js";

const BOT_START_TIME = Math.floor(Date.now() / 1000);

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
// User Preferences (in-memory storage)
// =============================================================================

/** In-memory storage for per-user preferences (exported for testing) */
export const userPreferences = new Map<number, UserPreferences>();

/** Clear user preferences (for testing) */
export function clearUserPreferences(): void {
  userPreferences.clear();
}

/**
 * Gets user preferences, creating defaults if not exists
 * @param userId - Telegram user ID
 * @param defaultProvider - Default LLM provider from config
 * @returns User preferences object
 */
export function getUserPreferences(
  userId: number,
  defaultProvider: ExtendedConfig["defaultLLMProvider"]
): UserPreferences {
  const existing = userPreferences.get(userId);
  if (existing) return existing;

  const defaults: UserPreferences = {
    userId,
    preferredProvider: defaultProvider,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  userPreferences.set(userId, defaults);
  return defaults;
}

/**
 * Sets user's preferred LLM provider
 * @param userId - Telegram user ID
 * @param provider - LLM provider type
 * @param defaultProvider - Default provider for fallback
 */
export function setUserProvider(
  userId: number,
  provider: ExtendedConfig["defaultLLMProvider"],
  defaultProvider: ExtendedConfig["defaultLLMProvider"]
): void {
  const prefs = getUserPreferences(userId, defaultProvider);
  userPreferences.set(userId, {
    ...prefs,
    preferredProvider: provider,
    updatedAt: new Date(),
  });
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
  const authService = createAuthService(config.authorizedUsers);

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
    const username = sanitizeText(ctx.from?.first_name || "user").substring(
      0,
      50
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
      "📖 **Usage Guide**\n\n" +
        "**Commands:**\n" +
        "/provider [name] - Show/set LLM provider\n" +
        "/index - Index codebase for RAG\n" +
        "/ask <question> - Query codebase via RAG\n" +
        "/status - Show system status\n\n" +
        "**Text Analysis:**\n" +
        '🔍 Example: "Explain project architecture"\n' +
        "⚡ Send text message for Claude CLI analysis.\n\n" +
        `Available providers: ${availableProviders.join(", ") || "none"}`
    );
  });

  // ==========================================================================
  // /provider command - Show or set LLM provider
  // ==========================================================================
  bot.command("provider", async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;

    const args = ctx.match?.toString().trim();
    const factoryConfig = toProviderFactoryConfig(config.llmApiKeys);
    const availableProviders = getAvailableProviders(factoryConfig);

    if (!args) {
      // Show current provider
      const prefs = getUserPreferences(userId, config.defaultLLMProvider);
      await ctx.reply(
        `🤖 **Current provider:** ${prefs.preferredProvider}\n\n` +
          `**Available:** ${availableProviders.join(", ") || "none"}\n\n` +
          `Usage: /provider <name>`
      );
      return;
    }

    // Validate provider name
    const provider = args.toLowerCase();
    const validProviders = ["openai", "gemini", "anthropic", "perplexity"];

    // Explicitly reject claude-code as user-selectable provider
    if (provider === "claude-code") {
      await ctx.reply(
        "❌ claude-code is used internally for CLI analysis and cannot be selected."
      );
      return;
    }

    if (!validProviders.includes(provider)) {
      await ctx.reply(
        `❌ Unknown provider "${args}". Valid: ${validProviders.join(", ")}`
      );
      return;
    }

    // Check if provider is available (has API key)
    const typedProvider = provider as LLMProviderType;
    if (!availableProviders.includes(typedProvider)) {
      await ctx.reply(
        `❌ Provider "${provider}" not configured. Available: ${availableProviders.join(", ") || "none"}`
      );
      return;
    }

    // Set provider (exclude claude-code from user selection)
    if (
      provider === "openai" ||
      provider === "gemini" ||
      provider === "anthropic" ||
      provider === "perplexity"
    ) {
      setUserProvider(userId, provider, config.defaultLLMProvider);
      await ctx.reply(`✅ Provider set to **${provider}**`);
    }
  });

  // ==========================================================================
  // /index command - Index codebase for RAG
  // ==========================================================================
  bot.command("index", async (ctx) => {
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
      const embeddingProvider = getEmbeddingProvider(factoryConfig);

      const metadata = await pipeline.index(
        config.projectPath,
        embeddingProvider,
        config.ragStorePath
      );

      await ctx.reply(
        `✅ **Indexing complete!**\n\n` +
          `📊 ${metadata.totalChunks} chunks\n` +
          `📝 ${metadata.totalTokens} tokens\n` +
          `📁 Project: ${metadata.projectPath}`
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

    const prefs = getUserPreferences(userId, config.defaultLLMProvider);
    const animationId = await startSimpleAnimation(ctx);

    try {
      const embeddingProvider = getEmbeddingProvider(factoryConfig);

      // Get API key for user's preferred provider
      const providerApiKey = config.llmApiKeys[prefs.preferredProvider];
      if (!providerApiKey) {
        await ctx.api.deleteMessage(ctx.chat.id, animationId).catch(() => {});
        await ctx.reply(
          `❌ API key not configured for ${prefs.preferredProvider}. ` +
            `Use /provider to select another provider.`
        );
        return;
      }

      const completionProvider = createCompletionProvider(
        prefs.preferredProvider,
        providerApiKey
      );

      const result = await pipeline.query(
        question,
        embeddingProvider,
        completionProvider
      );

      await ctx.api.deleteMessage(ctx.chat.id, animationId).catch(() => {});

      // Format sources (top 3)
      const sources = result.sources
        .slice(0, 3)
        .map((s, i) => `[${i + 1}] ${s.chunk.filePath}:${s.chunk.startLine}`)
        .join("\n");

      const sourcesSection = sources ? `\n\n📚 **Sources:**\n${sources}` : "";

      await ctx.reply(`🔍 **Answer:**\n\n${result.answer}${sourcesSection}`);
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
    const userId = ctx.from?.id;
    if (!userId) return;

    const prefs = getUserPreferences(userId, config.defaultLLMProvider);
    const factoryConfig = toProviderFactoryConfig(config.llmApiKeys);
    const availableProviders = getAvailableProviders(factoryConfig);

    let ragStatus = "Not initialized";
    if (ragPipeline) {
      const status = ragPipeline.getStatus();
      if (status.indexed && status.metadata) {
        ragStatus = `✅ Indexed (${status.metadata.totalChunks} chunks)`;
      } else {
        ragStatus = "❌ Not indexed";
      }
    }

    await ctx.reply(
      `📊 **System Status**\n\n` +
        `🤖 Your provider: ${prefs.preferredProvider}\n` +
        `📚 RAG Index: ${ragStatus}\n` +
        `🔧 Available providers: ${availableProviders.join(", ") || "none"}\n` +
        `📁 Project: ${config.projectPath}`
    );
  });

  // Text message handler
  bot.on("message:text", async (ctx) => {
    const username = sanitizeText(ctx.from?.first_name || "user").substring(
      0,
      50
    );

    if (ctx.message.date < BOT_START_TIME) {
      return;
    }

    const messageValidation = validateUserMessage(ctx.message.text);
    if (!messageValidation.success || !messageValidation.data) {
      await ctx.reply(`❌ ${messageValidation.error ?? "Validation failed"}`);
      return;
    }

    const question = sanitizeText(messageValidation.data);
    logger.info(`Request from ${username}: "${question.substring(0, 100)}..."`);

    let animationMessageId: number | null = null;

    try {
      animationMessageId = await startSimpleAnimation(ctx);

      const startTime = Date.now();
      const analysisResult = await executeClaudeAnalysis(question);
      const duration = Date.now() - startTime;

      try {
        await ctx.api.deleteMessage(ctx.chat.id, animationMessageId);
      } catch (error) {
        logger.debug("Failed to delete animation message:", error);
      }

      const summary = createSummary(analysisResult.summary);
      await ctx.reply(
        `✅ **Analysis completed**\n\n${summary}\n\n` +
          `📄 Detailed file attached.\n⏱️ Time: ${formatDuration(duration)}`
      );

      try {
        const fileContent = await readFile(analysisResult.filePath);
        await ctx.replyWithDocument(
          new InputFile(fileContent, analysisResult.fileName)
        );
      } catch (error) {
        logger.debug("Failed to send document:", error);
        await ctx.reply("⚠️ Analysis completed, but file attachment failed.");
      }
    } catch (error) {
      if (animationMessageId) {
        try {
          await ctx.api.deleteMessage(ctx.chat.id, animationMessageId);
        } catch (deleteError) {
          logger.debug("Failed to delete animation message:", deleteError);
        }
      }

      logger.error("Analysis error:", error);
      await ctx.reply("❌ Analysis failed. Try rephrasing your question.");
    }
  });

  // Handler for non-text messages
  bot.on("message", async (ctx) => {
    await ctx.reply("❌ Only text messages supported.");
  });

  logger.debug("Bot created");
  return bot;
}
