/**
 * Telegram bot for code analysis
 */

import { Bot, Context, InputFile } from "grammy";
import { readFile } from "fs/promises";
import { executeClaudeAnalysis } from "./claude.js";
import { createSummary, formatDuration, logger, loadConfig } from "./utils.js";
import { validateUserMessage, sanitizeText } from "./validation.js";

const BOT_START_TIME = Math.floor(Date.now() / 1000);

async function startSimpleAnimation(ctx: Context) {
  const message = await ctx.reply("⏳ Analyzing...");
  return message.message_id;
}

function checkAuth(userId: number, authorizedUsers: number[]): boolean {
  return authorizedUsers.includes(userId);
}

export function createBot(): Bot {
  const config = loadConfig();

  const bot = new Bot(config.telegramToken);

  bot.catch(async (err) => {
    logger.error("Bot error:", err.error);
    try {
      await err.ctx.reply("❌ Error occurred. Please try again later.");
    } catch {}
  });

  // /start command
  bot.command("start", async (ctx) => {
    const userId = ctx.from?.id || 0;
    if (!checkAuth(userId, config.authorizedUsers)) {
      await ctx.reply("🚫 Access denied. Contact administrator.");
      return;
    }

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
    const userId = ctx.from?.id || 0;
    if (!checkAuth(userId, config.authorizedUsers)) {
      await ctx.reply("🚫 Access denied.");
      return;
    }

    await ctx.reply(
      "📖 **Usage Guide**\n\n" +
        '🔍 Example: "Explain project architecture"\n' +
        "⚡ Send text message with your code question."
    );
  });

  // Text message handler
  bot.on("message:text", async (ctx) => {
    const userId = ctx.from?.id || 0;
    const username = sanitizeText(ctx.from?.first_name || "user").substring(
      0,
      50
    );

    if (!checkAuth(userId, config.authorizedUsers)) {
      await ctx.reply("🚫 Access denied.");
      return;
    }

    if (ctx.message.date < BOT_START_TIME) {
      return;
    }

    const messageValidation = validateUserMessage(ctx.message.text);
    if (!messageValidation.success) {
      await ctx.reply(`❌ ${messageValidation.error}`);
      return;
    }

    const question = sanitizeText(messageValidation.data!);
    logger.info(
      `Request from ${username} (${userId}): "${question.substring(0, 100)}..."`
    );

    let animationMessageId: number | null = null;

    try {
      animationMessageId = await startSimpleAnimation(ctx);

      const startTime = Date.now();
      const analysisResult = await executeClaudeAnalysis(question);
      const duration = Date.now() - startTime;

      try {
        await ctx.api.deleteMessage(ctx.chat.id, animationMessageId);
      } catch {}

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
      } catch {
        await ctx.reply("⚠️ Analysis completed, but file attachment failed.");
      }
    } catch (error) {
      if (animationMessageId) {
        try {
          await ctx.api.deleteMessage(ctx.chat.id, animationMessageId);
        } catch {}
      }

      logger.error("Analysis error:", error);
      await ctx.reply("❌ Analysis failed. Try rephrasing your question.");
    }
  });

  // Handler for non-text messages
  bot.on("message", async (ctx) => {
    const userId = ctx.from?.id || 0;
    if (!checkAuth(userId, config.authorizedUsers)) return;

    await ctx.reply("❌ Only text messages supported.");
  });

  logger.debug("Bot created");
  return bot;
}
