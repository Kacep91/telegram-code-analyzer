/**
 * Main module for Telegram Code Analyzer
 */

import "dotenv/config";
import { join } from "path";
import {
  createBot,
  ensureRagPipeline,
  toProviderFactoryConfig,
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
    const bot = createBot();

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
        logger.info(
          indexExists
            ? "Re-indexing due to new commits..."
            : "RAG index not found, starting auto-indexing..."
        );

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

        logger.info(
          `Auto-indexing completed: ${metadata.totalChunks} chunks, ${metadata.totalTokens} tokens`
        );
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
