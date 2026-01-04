/**
 * Telegram bot for code analysis
 */

import { Bot, Context, InputFile } from "grammy";
import { readFile } from "fs/promises";
import { executeClaudeAnalysis } from "./claude.js";
import { createSummary, formatDuration, logger, loadConfig } from "./utils.js";
import { validateUserMessage, sanitizeText } from "./validation.js";
import {
  isClaudeError,
  isValidationError,
  ClaudeErrorSubType,
} from "./errors/index.js";
import { createAuthService, authMiddleware } from "./auth.js";

const BOT_START_TIME = Math.floor(Date.now() / 1000);

async function startSimpleAnimation(ctx: Context) {
  const message = await ctx.reply("⏳ Analyzing...");
  return message.message_id;
}

export function createBot(): Bot {
  const config = loadConfig();
  const authService = createAuthService(config.authorizedUsers);

  const bot = new Bot(config.telegramToken);

  bot.catch(async (err) => {
    const error = err.error;

    if (isClaudeError(error)) {
      if (error.subType === ClaudeErrorSubType.TIMEOUT) {
        await err.ctx
          .reply("⏱️ Analysis timed out. Try a simpler question.")
          .catch((e) => logger.debug("Failed to send timeout reply:", e));
      } else {
        await err.ctx
          .reply(`❌ Analysis error: ${error.userMessage}`)
          .catch((e) => logger.debug("Failed to send error reply:", e));
      }
    } else if (isValidationError(error)) {
      await err.ctx
        .reply(`⚠️ Invalid input: ${error.message}`)
        .catch((e) => logger.debug("Failed to send validation reply:", e));
    } else {
      logger.error("Bot error:", error);
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
    await ctx.reply(
      "📖 **Usage Guide**\n\n" +
        '🔍 Example: "Explain project architecture"\n' +
        "⚡ Send text message with your code question."
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
