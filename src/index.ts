/**
 * Main module for Telegram Code Analyzer
 */

import "dotenv/config";
import { createBot } from "./bot.js";
import { checkClaudeAvailability } from "./claude.js";
import { logger } from "./utils.js";
import {
  SystemError,
  SystemErrorSubType,
  isAppError,
} from "./errors/index.js";

async function main(): Promise<void> {
  logger.info("Starting Telegram Code Analyzer...");

  try {
    const claudeAvailability = await checkClaudeAvailability();
    if (!claudeAvailability.available) {
      throw new SystemError(
        `Claude CLI not available: ${claudeAvailability.error}`,
        SystemErrorSubType.DEPENDENCY
      );
    }

    const bot = createBot();
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
