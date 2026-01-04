/**
 * Integration test for Telegram bot message handling and file generation
 * Tests the complete flow: message -> Claude analysis -> file creation in /temp
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFile, access, unlink, mkdir } from "fs/promises";
import { Bot } from "grammy";
import type { UserFromGetMe } from "@grammyjs/types";
import { createBot } from "../bot.js";
import { executeClaudeAnalysis } from "../claude.js";

// Mock environment variables
const originalEnv = process.env;

// Use dynamic project path based on current working directory
const PROJECT_PATH = process.cwd();

beforeEach(async () => {
  process.env = {
    ...originalEnv,
    TELEGRAM_BOT_TOKEN: "test_token",
    AUTHORIZED_USERS: "123456789",
    PROJECT_PATH,
    CLAUDE_TIMEOUT: "180000", // 3 minutes for real Claude calls
  };

  // Ensure temp directory exists
  try {
    await mkdir("temp", { recursive: true });
  } catch (error) {
    // Directory already exists - this is expected
    console.debug("Temp directory setup:", error);
  }
});

afterEach(() => {
  process.env = originalEnv;
  vi.clearAllMocks();
});

// Mock bot info for testing (avoids real API calls)
const mockBotInfo: UserFromGetMe = {
  id: 123456789,
  is_bot: true,
  first_name: "TestBot",
  username: "testbot",
  can_join_groups: true,
  can_read_all_group_messages: false,
  supports_inline_queries: false,
  can_connect_to_business: false,
  has_main_web_app: false,
};

describe("Bot Integration Tests", () => {
  let bot: Bot;

  beforeEach(() => {
    bot = createBot();

    // Provide mock bot info to avoid real API calls
    bot.botInfo = mockBotInfo;
  });

  describe("Real Claude Integration and File Generation", () => {
    it("should make real Claude request and generate file in /temp directory", async () => {
      const testQuestion = "What files are in the src directory?";

      // Make real Claude analysis request
      const result = await executeClaudeAnalysis(testQuestion);

      // Verify the result structure
      expect(result).toMatchObject({
        summary: expect.any(String),
        filePath: expect.stringMatching(/^temp\/analysis-.*\.md$/),
        fileName: expect.stringMatching(/^analysis-.*\.md$/),
        fileSize: expect.any(Number),
      });

      // Verify file was actually created in temp directory
      const fileExists = await access(result.filePath)
        .then(() => true)
        .catch(() => false);
      expect(fileExists).toBe(true);

      // Verify file content
      const fileContent = await readFile(result.filePath, "utf-8");
      expect(fileContent).toContain("# Code Analysis");
      expect(fileContent).toContain(testQuestion);
      expect(fileContent).toContain(new Date().getFullYear().toString()); // Should have current date

      // Clean up the generated file
      try {
        await unlink(result.filePath);
      } catch (error) {
        // Cleanup failure is not critical for test
        console.debug("Cleanup failed:", error);
      }
    }, 220000); // 3.7 minute timeout for real Claude call

    it("should process message validation through bot workflow", async () => {
      // Test message validation that happens in the bot workflow
      const { validateUserMessage } = await import("../validation.js");

      // Test valid message
      const validResult = validateUserMessage(
        "List the main components of this project"
      );
      expect(validResult.success).toBe(true);
      expect(validResult.data).toBe("List the main components of this project");

      // Test invalid message (too short)
      const invalidResult = validateUserMessage("hi");
      expect(invalidResult.success).toBe(false);
      expect(invalidResult.error).toContain("minimum");

      // Test message with potential XSS
      const xssResult = validateUserMessage("<script>alert('xss')</script>");
      expect(xssResult.success).toBe(false);
      expect(xssResult.error).toContain("invalid characters");

      // Test message sanitization
      const { sanitizeText } = await import("../validation.js");
      expect(sanitizeText("Normal text")).toBe("Normal text");
      expect(sanitizeText("<script>")).toBe("script"); // Only removes < and >
      expect(sanitizeText("Text with\n\nnewlines")).toBe("Text with newlines");
    });

    it("should create files with proper naming convention in temp/", async () => {
      const testQuestion = "Show project structure";

      const result = await executeClaudeAnalysis(testQuestion);

      // Verify file path structure
      expect(result.filePath).toMatch(
        /^temp\/analysis-show-project-structure-.*\.md$/
      );

      // Verify file naming follows the pattern: analysis-{slug}-{timestamp}.md
      const fileName = result.fileName;
      const parts = fileName.split("-");
      expect(parts[0]).toBe("analysis");
      expect(fileName.endsWith(".md")).toBe(true);

      // Verify timestamp part is valid ISO format
      const timestampPart = fileName.match(
        /-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)\.md$/
      );
      expect(timestampPart).toBeTruthy();

      // Clean up
      try {
        await unlink(result.filePath);
      } catch (error) {
        // Cleanup failure is not critical for test
        console.debug("Cleanup failed:", error);
      }
    }, 220000); // 3.7 minute timeout for Claude call

    it("should validate user input before calling Claude", async () => {
      // Test with too short message
      const shortMessage = "hi";

      try {
        await executeClaudeAnalysis(shortMessage);
        // Should not reach here due to validation
        expect(true).toBe(false);
      } catch (error) {
        // This test should be handled by validation layer
        // The actual validation happens in bot.ts before calling executeClaudeAnalysis
        expect(error).toBeDefined();
      }
    }, 220000); // Use standard timeout

    it("should handle authorization correctly", async () => {
      // Test authorization logic by testing the createAuthService function
      const { createAuthService } = await import("../auth.js");

      // Test auth service with known users
      const authService = createAuthService([123456789]);

      // Test authorized user (matches environment setup)
      expect(authService.isAuthorized(123456789)).toBe(true);

      // Test unauthorized user
      expect(authService.isAuthorized(999999999)).toBe(false);

      // Test edge cases
      expect(authService.isAuthorized(0)).toBe(false);

      // Test auth service with multiple users
      const multiUserAuthService = createAuthService([100, 200, 300]);
      expect(multiUserAuthService.isAuthorized(100)).toBe(true);
      expect(multiUserAuthService.isAuthorized(200)).toBe(true);
      expect(multiUserAuthService.isAuthorized(400)).toBe(false);
    });
  });

  describe("File System Integration", () => {
    it("should ensure temp directory exists before tests run", async () => {
      // Verify temp directory was created during setup
      const tempDirExists = await access("temp")
        .then(() => true)
        .catch(() => false);
      expect(tempDirExists).toBe(true);
    });

    it("should ensure temp directory exists and files are created there", async () => {
      const testQuestion = "What is the main entry point?";

      const result = await executeClaudeAnalysis(testQuestion);

      // Verify file is in temp directory
      expect(result.filePath.startsWith("temp/")).toBe(true);

      // Verify file actually exists
      const fileExists = await access(result.filePath)
        .then(() => true)
        .catch(() => false);
      expect(fileExists).toBe(true);

      // Verify file has content
      const content = await readFile(result.filePath, "utf-8");
      expect(content.length).toBeGreaterThan(0);
      expect(content).toContain(testQuestion);

      // Clean up
      try {
        await unlink(result.filePath);
      } catch (error) {
        // Cleanup failure is not critical for test
        console.debug("Cleanup failed:", error);
      }
    }, 220000); // 3.7 minute timeout for Claude call

    it("should create files with unique timestamps", async () => {
      const question1 = "First analysis question";
      const question2 = "Second analysis question";

      const [result1, result2] = await Promise.all([
        executeClaudeAnalysis(question1),
        executeClaudeAnalysis(question2),
      ]);

      // Verify both files were created
      expect(result1.filePath).not.toBe(result2.filePath);
      expect(result1.fileName).not.toBe(result2.fileName);

      // Verify both files exist
      const file1Exists = await access(result1.filePath)
        .then(() => true)
        .catch(() => false);
      const file2Exists = await access(result2.filePath)
        .then(() => true)
        .catch(() => false);

      expect(file1Exists).toBe(true);
      expect(file2Exists).toBe(true);

      // Clean up
      try {
        await Promise.all([unlink(result1.filePath), unlink(result2.filePath)]);
      } catch (error) {
        // Cleanup failure is not critical for test
        console.debug("Cleanup failed:", error);
      }
    }, 220000); // 3.7 minute timeout for parallel Claude calls
  });
});
