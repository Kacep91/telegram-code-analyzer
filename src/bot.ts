/**
 * Telegram bot for code analysis with RAG and multi-LLM support
 */

import { Bot, Context, InputFile, InlineKeyboard } from "grammy";
import { writeFile, unlink, mkdir } from "fs/promises";
import { join } from "path";
import {
  logger,
  loadExtendedConfig,
  getConfiguredProviders,
  getConfigValue,
  formatForTelegram,
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
  createCLICompletionAdapter,
  createFallbackProvider,
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

/**
 * Атомарный лок для операций индексации для предотвращения race conditions
 */
class IndexingLock {
  private locked = false;

  /**
   * Попытка захватить лок атомарно
   * @returns true если лок захвачен, false если уже залочен
   */
  tryAcquire(): boolean {
    if (this.locked) return false;
    this.locked = true;
    return true;
  }

  /**
   * Освободить лок
   */
  release(): void {
    this.locked = false;
  }

  /**
   * Проверить, залочен ли (для тестирования)
   */
  isLocked(): boolean {
    return this.locked;
  }
}

/** Экземпляр лока индексации */
const indexingLock = new IndexingLock();

/**
 * Проверить, выполняется ли индексация
 * @deprecated Используй getIndexingLock().isLocked() — сохранено для обратной совместимости
 */
export function isIndexingInProgress(): boolean {
  return indexingLock.isLocked();
}

/** Получить лок индексации (для тестирования) */
export function getIndexingLock(): {
  tryAcquire: () => boolean;
  release: () => void;
  isLocked: () => boolean;
} {
  return indexingLock;
}

/** Сбросить лок индексации (для тестирования) */
export function resetIndexingLock(): void {
  if (indexingLock.isLocked()) {
    indexingLock.release();
  }
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

// =============================================================================
// Progress Animation
// =============================================================================

const PROGRESS_STAGES: readonly [string, string, string] = [
  "🔍 Searching code...",
  "🧠 Analyzing results...",
  "✍️ Generating answer...",
] as const;

/**
 * Builds status message for system status display
 * Used by both /status command and status callback
 * @param config - Extended configuration
 * @returns Formatted status message HTML string
 */
async function buildStatusMessage(config: ExtendedConfig): Promise<string> {
  const factoryConfig = toProviderFactoryConfig(config.llmApiKeys);
  const availableProviders = getAvailableProviders(factoryConfig);

  let ragStatus = "Not initialized";
  let cacheStats = "";

  if (ragPipeline) {
    const status = ragPipeline.getStatus();
    if (status.indexed && status.metadata) {
      ragStatus = `✅ Indexed (${status.metadata.totalChunks} chunks)`;
      const indexedDate = new Date(status.metadata.indexedAt);
      const cache = ragPipeline.getCacheStats();
      const hitRatePercent = Number.isNaN(cache.hitRate) ? 0 : Math.round(cache.hitRate * 100);
      cacheStats = `\n📅 Last indexed: ${indexedDate.toLocaleString("en-US")}` +
                   `\n📈 Cache hit rate: ${hitRatePercent}%` +
                   `\n🔢 Cache entries: ${cache.size}`;
    } else {
      ragStatus = "❌ Not indexed";
    }
  }

  return `📊 <b>System status</b>\n\n` +
    `🤖 LLM provider: ${config.defaultLLMProvider}\n` +
    `📚 RAG index: ${ragStatus}${cacheStats}\n` +
    `🔧 Available providers: ${availableProviders.join(", ") || "none"}\n` +
    `📁 Project: ${config.projectPath}`;
}

/**
 * Creates an animated progress indicator with stage updates
 * @param ctx - Telegram context
 * @returns Object with methods to update and stop the animation
 */
export async function animatedProgress(ctx: Context): Promise<{
  messageId: number;
  update: (stage: number) => Promise<void>;
  stop: () => Promise<void>;
}> {
  const message = await ctx.reply(PROGRESS_STAGES[0]);
  const chatId = ctx.chat?.id;
  let currentStage = 0;

  return {
    messageId: message.message_id,
    update: async (stage: number) => {
      if (!chatId) return;
      if (stage >= 0 && stage < PROGRESS_STAGES.length && stage !== currentStage) {
        currentStage = stage;
        const stageText = PROGRESS_STAGES[stage as 0 | 1 | 2];
        await ctx.api
          .editMessageText(chatId, message.message_id, stageText)
          .catch(() => {});
      }
    },
    stop: async () => {
      if (!chatId) return;
      await ctx.api.deleteMessage(chatId, message.message_id).catch(() => {});
    },
  };
}

// =============================================================================
// Ask Query Handler (shared logic for /ask command and text messages)
// =============================================================================

/**
 * Handles RAG query - shared logic for /ask command and direct text messages
 * @param ctx - Telegram context
 * @param question - User's question (already sanitized)
 * @param config - Extended configuration
 */
async function handleAskQuery(
  ctx: Context,
  question: string,
  config: ExtendedConfig
): Promise<void> {
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
    await ctx.reply("❌ Codebase not indexed. Use /index.");
    return;
  }

  const progress = await animatedProgress(ctx);

  let tempFilePath: string | null = null;

  try {
    const embeddingProvider = getEmbeddingProvider(
      factoryConfig,
      config.defaultEmbeddingProvider
    );

    // Create completion provider with CLI fallback
    // Priority: Claude Code CLI -> configured API provider
    const providers: import("./llm/types.js").LLMCompletionProvider[] = [];

    // Try Claude Code CLI first with Haiku model (fastest for short scoring prompts)
    const cliAdapter = await createCLICompletionAdapter(config.projectPath, 30000, "haiku");
    if (cliAdapter) {
      providers.push(cliAdapter);
      console.log("[RAG] Claude Code CLI (haiku) available, using as primary provider");
    }

    // Add configured API provider as fallback
    const providerApiKey = config.llmApiKeys[config.defaultLLMProvider];
    if (providerApiKey) {
      providers.push(createCompletionProvider(config.defaultLLMProvider, providerApiKey));
    }

    if (providers.length === 0) {
      await progress.stop();
      await ctx.reply(
        `❌ No completion provider available. Configure API key or install Claude Code CLI.`
      );
      return;
    }

    // Use single provider or create fallback chain
    const completionProvider = providers.length === 1
      ? providers[0]!
      : createFallbackProvider(providers);

    // Stage 1: Searching
    await progress.update(1);

    const result = await pipeline.query(
      question,
      embeddingProvider,
      completionProvider
    );

    // Stage 2: Generating answer
    await progress.update(2);

    await progress.stop();

    // Format sources
    const maxSources = getConfigValue("RAG_MAX_SOURCES_DISPLAY");
    const sources = result.sources
      .slice(0, maxSources)
      .map((s, i) => `[${i + 1}] ${s.chunk.filePath}:${s.chunk.startLine}`)
      .join("\n");

    // Create full markdown content for file
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const tempDir = join(process.cwd(), "temp");
    const fileName = `answer-${timestamp}.md`;
    tempFilePath = join(tempDir, fileName);

    const markdownContent = [
      `# Question`,
      ``,
      question,
      ``,
      `# Answer`,
      ``,
      result.answer,
      ``,
      sources ? `# Sources\n\n${sources}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    // Create temp directory if not exists
    await mkdir(tempDir, { recursive: true });

    // Write markdown file
    await writeFile(tempFilePath, markdownContent, "utf-8");

    // Send brief answer (first 500 chars) + full .md file
    const BRIEF_ANSWER_MAX_LENGTH = 500;
    const briefAnswer = result.answer.length > BRIEF_ANSWER_MAX_LENGTH
      ? result.answer.slice(0, BRIEF_ANSWER_MAX_LENGTH) + "..."
      : result.answer;

    const formattedBrief = formatForTelegram(briefAnswer);
    await ctx.reply(`🔍 <b>Answer:</b>\n\n${formattedBrief}`, { parse_mode: "HTML" });

    // Send the .md file as document
    await ctx.replyWithDocument(new InputFile(tempFilePath, fileName), {
      caption: "📄 Full answer with sources",
    });
  } catch (error) {
    await progress.stop();
    const message = error instanceof Error ? error.message : "Unknown error";
    logger.error("RAG query failed:", sanitizeErrorMessage(String(error)));
    await ctx.reply(`❌ Query error: ${sanitizeErrorMessage(message)}`);
  } finally {
    // Cleanup temp file - guaranteed execution
    if (tempFilePath) {
      await unlink(tempFilePath).catch(() => {});
    }
  }
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
          .reply("⏱️ Request timed out. Try simplifying your question.")
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
        .reply("❌ An error occurred. Please try again later.")
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

    const keyboard = new InlineKeyboard()
      .text("📖 Help", "help")
      .text("📊 Status", "status");

    await ctx.reply(
      `👋 Hello, ${username}!\n\n` +
        "🤖 Code analysis bot using RAG.\n\n" +
        "📝 Just send a question about the code — I'll answer!",
      { reply_markup: keyboard }
    );
  });

  // Callback handlers for inline keyboard
  bot.callbackQuery("help", async (ctx) => {
    await ctx.answerCallbackQuery();
    const availableProviders = getConfiguredProviders(config.llmApiKeys);
    await ctx.reply(
      "📖 <b>Guide</b>\n\n" +
        "<b>Commands:</b>\n" +
        "/index — Index codebase\n" +
        "/ask &lt;question&gt; — Query code via RAG\n" +
        "/status — System status\n\n" +
        "<b>Code analysis:</b>\n" +
        '🔍 Example: "Explain the project architecture"\n' +
        "⚡ Just send a text message!\n\n" +
        `Available providers: ${availableProviders.join(", ") || "none"}`,
      { parse_mode: "HTML" }
    );
  });

  bot.callbackQuery("status", async (ctx) => {
    await ctx.answerCallbackQuery();
    const statusMessage = await buildStatusMessage(config);
    await ctx.reply(statusMessage, { parse_mode: "HTML" });
  });

  // /help command
  bot.command("help", async (ctx) => {
    const availableProviders = getConfiguredProviders(config.llmApiKeys);
    await ctx.reply(
      "📖 <b>Guide</b>\n\n" +
        "<b>Commands:</b>\n" +
        "/index — Index codebase\n" +
        "/ask &lt;question&gt; — Query code via RAG\n" +
        "/status — System status\n\n" +
        "<b>Code analysis:</b>\n" +
        '🔍 Example: "Explain the project architecture"\n' +
        "⚡ Just send a text message!\n\n" +
        `Available providers: ${availableProviders.join(", ") || "none"}`,
      { parse_mode: "HTML" }
    );
  });

  // ==========================================================================
  // /index command - Index codebase for RAG (admin only)
  // Supports incremental indexing by default, use --full for full reindex
  // ==========================================================================
  bot.command("index", async (ctx) => {
    // Admin-only command
    const userId = ctx.from?.id;
    if (!userId || !authService.isAdmin(userId)) {
      await ctx.reply("🚫 Only administrators can run indexing.");
      return;
    }

    // Check for --full flag first (before acquiring lock)
    const args = ctx.match?.toString().trim() ?? "";
    if (args && args !== "--full") {
      await ctx.reply(
        "⚠️ Unknown option: " + args + "\n\n" +
        "Usage: /index [--full]\n" +
        "• /index — incremental indexing (default)\n" +
        "• /index --full — full reindexing"
      );
      return;
    }
    const forceFullIndex = args === "--full";

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

    // Atomically acquire lock to prevent concurrent indexing (TOCTOU fix)
    if (!indexingLock.tryAcquire()) {
      await ctx.reply("⏳ Indexing already in progress. Please wait.");
      return;
    }

    try {
      const pipeline = await ensureRagPipeline(config);
      const embeddingProvider = getEmbeddingProvider(
        factoryConfig,
        config.defaultEmbeddingProvider
      );

      // Progress callback for long indexing operations
      const PROGRESS_INTERVAL_MS = 5000;
      let lastProgressUpdate = Date.now();

      const onProgress = async (
        current: number,
        total: number,
        stage: string
      ): Promise<void> => {
        const now = Date.now();
        if (now - lastProgressUpdate >= PROGRESS_INTERVAL_MS) {
          lastProgressUpdate = now;
          const percent = Math.round((current / total) * 100);
          await ctx.reply(`📊 ${stage}: ${current}/${total} (${percent}%)`).catch((e) => {
            logger.debug("Progress update failed:", e);
          });
        }
      };

      const status = pipeline.getStatus();
      const hasManifest = pipeline.hasManifest();
      // Incremental indexing requires: existing index + manifest for change tracking + no --full flag
      const canDoIncremental = status.indexed && hasManifest && !forceFullIndex;

      if (canDoIncremental) {
        // Incremental indexing
        await ctx.reply("📚 Starting incremental indexing...");

        const result = await pipeline.indexIncremental(
          config.projectPath,
          embeddingProvider,
          config.ragStorePath,
          onProgress
        );

        const { stats } = result;
        const hasChanges = stats.added > 0 || stats.modified > 0 || stats.deleted > 0;

        if (hasChanges) {
          await ctx.reply(
            `✅ <b>Incremental indexing complete!</b>\n\n` +
              `📊 Total: ${result.metadata.totalChunks} chunks\n` +
              `➕ Added: ${stats.added} files\n` +
              `✏️ Modified: ${stats.modified} files\n` +
              `🗑️ Deleted: ${stats.deleted} files\n` +
              `⏭️ Unchanged: ${stats.unchanged} files`,
            { parse_mode: "HTML" }
          );
        } else {
          await ctx.reply(
            `✅ <b>No changes detected</b>\n\n` +
              `📊 Index is up to date (${result.metadata.totalChunks} chunks)\n` +
              `⏭️ Files checked: ${stats.unchanged}`,
            { parse_mode: "HTML" }
          );
        }
      } else {
        // Full indexing
        const reason = forceFullIndex
          ? "(forced)"
          : "(first run or rebuild required)";
        await ctx.reply(`📚 Starting full indexing ${reason}... This may take a while.`);

        const metadata = await pipeline.index(
          config.projectPath,
          embeddingProvider,
          config.ragStorePath,
          onProgress
        );

        await ctx.reply(
          `✅ <b>Full indexing complete!</b>\n\n` +
            `📊 ${metadata.totalChunks} chunks\n` +
            `📝 ${metadata.totalTokens} tokens\n` +
            `📁 Project: ${metadata.projectPath}`,
          { parse_mode: "HTML" }
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      logger.error("Indexing failed:", sanitizeErrorMessage(String(error)));
      await ctx.reply(`❌ Indexing error: ${sanitizeErrorMessage(message)}`);
    } finally {
      indexingLock.release();
    }
  });

  // ==========================================================================
  // /ask command - Query codebase via RAG
  // ==========================================================================
  bot.command("ask", async (ctx) => {
    const rawQuestion = ctx.match?.toString().trim();
    if (!rawQuestion) {
      await ctx.reply("❌ Usage: /ask <your code question>");
      return;
    }

    // Validate the question like regular messages
    const validation = validateUserMessage(rawQuestion);
    if (!validation.success || !validation.data) {
      await ctx.reply(`❌ ${validation.error ?? "Invalid question"}`);
      return;
    }

    const question = sanitizeText(validation.data);
    await handleAskQuery(ctx, question, config);
  });

  // ==========================================================================
  // /status command - Show system status
  // ==========================================================================
  bot.command("status", async (ctx) => {
    const statusMessage = await buildStatusMessage(config);
    await ctx.reply(statusMessage, { parse_mode: "HTML" });
  });

  // Handler for text messages without commands - direct RAG query
  bot.on("message:text", async (ctx) => {
    const rawMessage = ctx.message.text;

    // Validate the message
    const validation = validateUserMessage(rawMessage);
    if (!validation.success || !validation.data) {
      await ctx.reply(`❌ ${validation.error ?? "Invalid message"}`);
      return;
    }

    const question = sanitizeText(validation.data);
    await handleAskQuery(ctx, question, config);
  });

  // Handler for non-text messages
  bot.on("message", async (ctx) => {
    await ctx.reply("❌ Only text messages are supported.");
  });

  logger.debug("Bot created");
  return bot;
}
