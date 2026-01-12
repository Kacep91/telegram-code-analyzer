/**
 * Main module for Telegram Code Analyzer
 */

import "dotenv/config";
import { join } from "path";
import { Bot } from "grammy";
import {
  createBot,
  ensureRagPipeline,
  toProviderFactoryConfig,
  getIndexingLock,
} from "./bot.js";
import { checkClaudeAvailability } from "./claude.js";
import {
  logger,
  loadExtendedConfig,
  gitPull,
  getLastCommitDate,
} from "./utils.js";
import { SystemError, SystemErrorSubType, isAppError } from "./errors/index.js";
import { CodeVectorStore } from "./rag/store.js";
import { getAvailableProviders, getEmbeddingProvider } from "./llm/index.js";

const DEFAULT_STORE_FILENAME = "rag-index.json";

/** Global bot instance for graceful shutdown */
let bot: Bot | null = null;

/**
 * Graceful shutdown handler
 * Stops the bot and cleans up resources before exit
 */
async function shutdown(signal: string): Promise<void> {
  logger.info(`Received ${signal}, shutting down gracefully...`);

  try {
    const indexingLock = getIndexingLock();

    // Wait for indexing to complete if in progress
    if (indexingLock.isLocked()) {
      logger.info("Waiting for indexing to complete...");
      // Give indexing some time to finish (max 30 seconds)
      const maxWait = 30_000;
      const startTime = Date.now();
      while (indexingLock.isLocked() && Date.now() - startTime < maxWait) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      if (indexingLock.isLocked()) {
        logger.warn("Indexing did not complete in time, forcing shutdown");
      }
    }

    // Stop bot (stops receiving new updates)
    if (bot) {
      await bot.stop();
      logger.info("Bot stopped");
    }

    logger.info("Shutdown complete");
    process.exit(0);
  } catch (error) {
    logger.error("Error during shutdown:", error);
    process.exit(1);
  }
}

async function main(): Promise<void> {
  logger.info("Starting Telegram Code Analyzer...");

  try {
    logger.info("Checking Claude CLI availability...");
    const claudeAvailability = await checkClaudeAvailability();
    logger.info(
      `Claude CLI check result: ${JSON.stringify(claudeAvailability)}`
    );
    if (!claudeAvailability.available) {
      throw new SystemError(
        `Claude CLI not available: ${claudeAvailability.error}`,
        SystemErrorSubType.DEPENDENCY
      );
    }

    const config = loadExtendedConfig();

    // =========================================================================
    // Git pull (if PROJECT_PATH is a git repo)
    // =========================================================================
    if (config.projectPath) {
      logger.info("Checking for updates via git pull...");
      await gitPull(config.projectPath);
    }

    // =========================================================================
    // Create bot
    // =========================================================================
    logger.info("Creating bot...");
    bot = createBot();

    // =========================================================================
    // Auto-indexing logic
    // =========================================================================
    const indexPath = join(config.ragStorePath, DEFAULT_STORE_FILENAME);
    const indexExists = await CodeVectorStore.exists(indexPath);

    let needsReindex = !indexExists;

    // Check if commits are newer than index
    if (indexExists && config.projectPath) {
      const lastCommitDate = await getLastCommitDate(config.projectPath);

      if (lastCommitDate) {
        const pipeline = await ensureRagPipeline(config);
        const status = pipeline.getStatus();

        if (status.metadata?.indexedAt) {
          const commitTime = new Date(lastCommitDate).getTime();
          const indexTime = new Date(status.metadata.indexedAt).getTime();

          if (commitTime > indexTime) {
            logger.info("New commits detected after last indexing");
            needsReindex = true;
          }
        }
      }
    }

    // Perform auto-indexing if needed
    if (needsReindex) {
      const factoryConfig = toProviderFactoryConfig(config.llmApiKeys);
      const availableProviders = getAvailableProviders(factoryConfig);
      const hasEmbeddingProvider = availableProviders.some(
        (p) => p === "openai" || p === "gemini" || p === "jina"
      );

      if (hasEmbeddingProvider) {
        const pipeline = await ensureRagPipeline(config);
        const embeddingProvider = getEmbeddingProvider(
          factoryConfig,
          config.defaultEmbeddingProvider
        );

        // Incremental indexing if: index exists + manifest exists
        const hasManifest = pipeline.hasManifest();
        const canDoIncremental = indexExists && hasManifest;

        if (canDoIncremental) {
          logger.info("New commits detected, starting incremental indexing...");
          const result = await pipeline.indexIncremental(
            config.projectPath,
            embeddingProvider,
            config.ragStorePath
          );
          const { stats } = result;
          logger.info(
            `Incremental indexing completed: +${stats.added} added, ~${stats.modified} modified, -${stats.deleted} deleted, ${stats.unchanged} unchanged`
          );
        } else {
          logger.info(
            indexExists
              ? "Re-indexing (manifest not found, full rebuild required)..."
              : "RAG index not found, starting auto-indexing..."
          );
          const metadata = await pipeline.index(
            config.projectPath,
            embeddingProvider,
            config.ragStorePath
          );
          logger.info(
            `Full indexing completed: ${metadata.totalChunks} chunks, ${metadata.totalTokens} tokens`
          );
        }
      } else {
        logger.warn(
          "Skipping auto-index: no embedding provider configured (need Jina, OpenAI, or Gemini)"
        );
      }
    }

    // =========================================================================
    // Start bot
    // =========================================================================
    logger.info("Starting bot...");

    // Register signal handlers for graceful shutdown
    process.on("SIGINT", () => shutdown("SIGINT"));
    process.on("SIGTERM", () => shutdown("SIGTERM"));

    await bot.start();
    logger.info("Telegram Code Analyzer is ready!");
  } catch (error) {
    if (isAppError(error)) {
      logger.error(`Startup error [${error.code}]: ${error.message}`);
    } else {
      logger.error("Startup error:", error);
    }
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    logger.error("Fatal error:", error);
    process.exit(1);
  });
}

export { main };
