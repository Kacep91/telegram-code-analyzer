/**
 * Main module for Telegram Code Analyzer
 */

import "dotenv/config";
import { createBot } from "./bot.js";
import { checkClaudeAvailability } from "./claude.js";
import { logger } from "./utils.js";

async function main(): Promise<void> {
  logger.info("Starting Telegram Code Analyzer...");

  try {
    const claudeAvailability = await checkClaudeAvailability();
    if (!claudeAvailability.available) {
      logger.error(`Claude CLI not available: ${claudeAvailability.error}`);
      process.exit(1);
    }

    const bot = createBot();
    await bot.start();
    logger.info("Telegram Code Analyzer is ready!");
  } catch (error) {
    logger.error("Startup error:", error);
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
