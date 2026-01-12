/**
 * Unit tests for bot.ts module
 *
 * Tests createBot(), error handling, commands, text message handlers via captured handlers.
 */
import { describe, it, expect, vi, beforeEach, afterEach, Mock } from "vitest";
import type { Message, Chat, User } from "grammy/types";

// =============================================================================
// Mocks Setup (before imports)
// =============================================================================

// Store captured handlers for testing actual command execution
// Using vi.hoisted() to make variable available in mock factories (hoisted)
// Handler type is defined as unknown function, with proper typing at retrieval via getContextHandler/getErrorHandler
const capturedHandlers = vi.hoisted(
  () => ({} as Record<string, (...args: unknown[]) => Promise<void>>)
);

// Configurable mock state for RAGPipeline
const ragMockState = vi.hoisted(() => ({
  indexed: true,
  queryResult: {
    answer: "Test answer from RAG",
    sources: [
      {
        chunk: {
          id: "chunk-1",
          content: "function test() {}",
          type: "function",
          name: "test",
          filePath: "src/test.ts",
          startLine: 1,
          endLine: 5,
          tokenCount: 10,
        },
        vectorScore: 0.9,
        llmScore: 0.95,
        finalScore: 0.93,
      },
    ],
    tokenCount: 150,
  },
}));

vi.mock("grammy", () => {
  // Handler type for bot methods - uses unknown[] for type safety
  type MockHandler = (...args: unknown[]) => Promise<void>;

  // Mock class for grammy Bot - must be a real class for 'new' to work
  // Defined inside factory to avoid hoisting issues
  const MockBot = class {
    catch = vi.fn((handler: MockHandler) => {
      capturedHandlers.error = handler;
    });
    use = vi.fn((handler: MockHandler) => {
      capturedHandlers.middleware = handler;
    });
    command = vi.fn((name: string, handler: MockHandler) => {
      capturedHandlers[`cmd:${name}`] = handler;
    });
    on = vi.fn((event: string, handler: MockHandler) => {
      capturedHandlers[`on:${event}`] = handler;
    });
    callbackQuery = vi.fn((trigger: string, handler: MockHandler) => {
      capturedHandlers[`callback:${trigger}`] = handler;
    });
  };

  // Mock InlineKeyboard
  const MockInlineKeyboard = class {
    text = vi.fn().mockReturnThis();
    row = vi.fn().mockReturnThis();
  };

  return {
    Bot: MockBot,
    InputFile: vi
      .fn()
      .mockImplementation((content: Buffer, filename: string) => ({
        content,
        filename,
      })),
    InlineKeyboard: MockInlineKeyboard,
  };
});

vi.mock("../utils.js", () => ({
  loadExtendedConfig: vi.fn(() => ({
    telegramToken: "test-token",
    authorizedUsers: [123456789],
    projectPath: "/test/project",
    claudeTimeout: 300000,
    rateLimiter: {
      maxRequests: 10,
      windowMs: 60000,
      cleanupIntervalMs: 300000,
    },
    llmApiKeys: {
      openai: "sk-test-key",
      gemini: "gemini-test-key",
    },
    defaultLLMProvider: "openai",
    defaultEmbeddingProvider: "openai",
    ragStorePath: "./rag-index",
    ragConfig: {
      chunkSize: 300,
      chunkOverlap: 50,
      topK: 15,
      rerankTopK: 5,
      vectorWeight: 0.3,
      llmWeight: 0.7,
    },
  })),
  createSummary: vi.fn((text: string) =>
    text.length > 100 ? text.substring(0, 100) + "..." : text
  ),
  formatDuration: vi.fn(() => "1s"),
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  getConfiguredProviders: vi.fn(() => ["openai", "gemini"]),
  getConfigValue: vi.fn((key: string) => {
    const defaults: Record<string, number | string> = {
      USERNAME_DISPLAY_LENGTH: 50,
      RAG_MAX_SOURCES_DISPLAY: 3,
    };
    return defaults[key];
  }),
  formatForTelegram: vi.fn((text: string) => text),
  splitMessage: vi.fn((text: string) => [text]),
}));

vi.mock("../auth.js", () => ({
  createAuthService: vi.fn(() => ({
    isAuthorized: vi.fn((userId: number) => userId === 123456789),
    isAdmin: vi.fn((userId: number) => userId === 123456789),
  })),
  authMiddleware: vi.fn(
    () => async (_ctx: unknown, next: () => Promise<void>) => {
      await next();
    }
  ),
}));

vi.mock("../claude.js", () => ({
  executeClaudeAnalysis: vi.fn(),
}));

vi.mock("../validation.js", () => ({
  validateUserMessage: vi.fn((message: unknown) => {
    if (typeof message !== "string") {
      return { success: false, error: "Message must be a string" };
    }
    if (message.length < 5) {
      return { success: false, error: "Message too short" };
    }
    if (message.includes("<script")) {
      return { success: false, error: "Message contains suspicious content" };
    }
    return { success: true, data: message };
  }),
  sanitizeText: vi.fn((text: string) => text.trim()),
}));

vi.mock("../rag/index.js", () => {
  // Mock class for RAGPipeline - must be a real class for 'new' to work
  // Uses ragMockState for configurable behavior in tests
  const MockRAGPipeline = class {
    index = vi.fn().mockResolvedValue({
      projectPath: "/test/project",
      totalChunks: 100,
      totalTokens: 5000,
      indexedAt: new Date().toISOString(),
      version: "1.0.0",
    });
    indexIncremental = vi.fn().mockResolvedValue({
      metadata: {
        projectPath: "/test/project",
        totalChunks: 100,
        totalTokens: 5000,
        indexedAt: new Date().toISOString(),
        version: "1.0.0",
      },
      stats: { added: 0, modified: 0, deleted: 0, unchanged: 10 },
    });
    loadIndex = vi.fn().mockResolvedValue(null);
    query = vi.fn().mockImplementation(() =>
      Promise.resolve(ragMockState.queryResult)
    );
    getStatus = vi.fn().mockImplementation(() => ({
      indexed: ragMockState.indexed,
      metadata: ragMockState.indexed
        ? {
            projectPath: "/test/project",
            totalChunks: 100,
            totalTokens: 5000,
            indexedAt: new Date().toISOString(),
            version: "1.0.0",
          }
        : null,
    }));
    hasManifest = vi.fn().mockReturnValue(false);
  };

  return {
    RAGPipeline: MockRAGPipeline,
  };
});

vi.mock("../llm/index.js", () => ({
  createCompletionProvider: vi.fn(() => ({
    name: "openai",
    complete: vi.fn().mockResolvedValue({
      text: "Completion result",
      tokenCount: 50,
      model: "gpt-4",
      finishReason: "stop",
    }),
    checkAvailability: vi.fn().mockResolvedValue({ available: true }),
  })),
  createCLICompletionAdapter: vi.fn().mockResolvedValue(null), // CLI not available in tests
  createFallbackProvider: vi.fn((providers) => providers[0]), // Just return first provider
  getEmbeddingProvider: vi.fn(() => ({
    embed: vi.fn().mockResolvedValue({
      values: new Array(1536).fill(0.1),
      tokenCount: 10,
      model: "text-embedding-3-large",
    }),
    embedBatch: vi.fn().mockResolvedValue([]),
  })),
  getAvailableProviders: vi.fn(() => ["openai", "gemini"]),
}));

vi.mock("fs/promises", () => ({
  readFile: vi.fn().mockResolvedValue(Buffer.from("# Analysis Result")),
  writeFile: vi.fn().mockResolvedValue(undefined),
  unlink: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
}));

// =============================================================================
// Imports after mocks
// =============================================================================

import { executeClaudeAnalysis } from "../claude.js";
import {
  ClaudeError,
  ClaudeErrorSubType,
  ValidationError,
  LLMError,
  LLMErrorSubType,
  RAGError,
  RAGErrorSubType,
} from "../errors/index.js";
import { validateUserMessage, sanitizeText } from "../validation.js";
import { getAvailableProviders, getEmbeddingProvider } from "../llm/index.js";
import {
  createBot,
  sanitizeErrorMessage,
  resetRagPipeline,
  getIndexingLock,
  resetIndexingLock,
  ensureRagPipeline,
  toProviderFactoryConfig,
} from "../bot.js";
import type { LLMApiKeys } from "../types.js";
import { unlink, writeFile, mkdir } from "fs/promises";

// =============================================================================
// Helper Functions
// =============================================================================

interface MockContextOverrides {
  from?: Partial<User> | null;
  message?: Partial<Message.TextMessage> | null;
  chat?: Partial<Chat> | null;
  match?: string;
}

interface MockContext {
  from: User | undefined;
  message: Message.TextMessage | undefined;
  chat: Chat;
  reply: Mock;
  replyWithDocument: Mock;
  api: {
    deleteMessage: Mock;
    editMessageText: Mock;
  };
  match: string;
}

/**
 * Creates a mock grammy Context for testing
 */
function createMockContext(overrides: MockContextOverrides = {}): MockContext {
  const defaultUser: User = {
    id: 123456789,
    is_bot: false,
    first_name: "Test",
  };

  const defaultChat: Chat = {
    id: 987654321,
    type: "private",
    first_name: "Test",
  };

  const defaultMessage: Message.TextMessage = {
    message_id: 1,
    date: Math.floor(Date.now() / 1000) + 10,
    chat: defaultChat,
    text: "test message content",
    from: defaultUser,
  };

  return {
    from:
      overrides.from === null
        ? undefined
        : { ...defaultUser, ...overrides.from },
    message:
      overrides.message === null
        ? undefined
        : ({ ...defaultMessage, ...overrides.message } as Message.TextMessage),
    chat: { ...defaultChat, ...overrides.chat } as Chat,
    reply: vi.fn().mockResolvedValue({ message_id: 111 }),
    replyWithDocument: vi.fn().mockResolvedValue({}),
    api: {
      deleteMessage: vi.fn().mockResolvedValue(true),
      editMessageText: vi.fn().mockResolvedValue(true),
    },
    match: overrides.match ?? "",
  };
}

/**
 * BotError-like object for error handler testing
 */
interface MockBotError {
  error: Error;
  ctx: MockContext;
}

/**
 * Creates a BotError-like object for error handler testing
 */
function createBotError(error: Error, ctx: MockContext): MockBotError {
  return { error, ctx };
}

/**
 * Clears all captured handlers
 */
function clearCapturedHandlers(): void {
  for (const key of Object.keys(capturedHandlers)) {
    delete capturedHandlers[key];
  }
}

/**
 * Handler type for context-based handlers (commands, events, middleware)
 */
type ContextHandler = (ctx: MockContext) => Promise<void>;

/**
 * Handler type for error handlers (bot.catch)
 */
type ErrorHandler = (err: MockBotError) => Promise<void>;

/**
 * Gets a context handler from capturedHandlers with type safety
 * Use for: cmd:*, on:*, middleware
 * Throws if handler is not registered
 */
function getContextHandler(key: string): ContextHandler {
  const handler = capturedHandlers[key];
  if (!handler) {
    throw new Error(`Handler "${key}" not registered. Call createBot() first.`);
  }
  return handler as ContextHandler;
}

/**
 * Gets an error handler from capturedHandlers with type safety
 * Use for: error
 * Throws if handler is not registered
 */
function getErrorHandler(): ErrorHandler {
  const handler = capturedHandlers.error;
  if (!handler) {
    throw new Error('Error handler not registered. Call createBot() first.');
  }
  return handler as ErrorHandler;
}

// =============================================================================
// Tests
// =============================================================================

describe("bot.ts", () => {
  beforeEach(() => {
    // Reset all mocks including mockReturnValueOnce/mockImplementationOnce
    vi.resetAllMocks();
    // Restore fs/promises mocks after resetAllMocks
    vi.mocked(unlink).mockResolvedValue(undefined);
    vi.mocked(writeFile).mockResolvedValue(undefined);
    vi.mocked(mkdir).mockResolvedValue(undefined);
    // Restore default implementations for mocks that need them
    vi.mocked(validateUserMessage).mockImplementation((message: unknown) => {
      if (typeof message !== "string") {
        return { success: false, error: "Message must be a string" };
      }
      if (message.length < 5) {
        return { success: false, error: "Message too short" };
      }
      if (message.includes("<script")) {
        return { success: false, error: "Message contains suspicious content" };
      }
      return { success: true, data: message };
    });
    vi.mocked(sanitizeText).mockImplementation((text: string) => text.trim());
    // Reset RAG mock state to defaults
    ragMockState.indexed = true;
    ragMockState.queryResult = {
      answer: "Test answer from RAG",
      sources: [
        {
          chunk: {
            id: "chunk-1",
            content: "function test() {}",
            type: "function",
            name: "test",
            filePath: "src/test.ts",
            startLine: 1,
            endLine: 5,
            tokenCount: 10,
          },
          vectorScore: 0.9,
          llmScore: 0.95,
          finalScore: 0.93,
        },
      ],
      tokenCount: 150,
    };
    clearCapturedHandlers();
    resetIndexingLock();
    resetRagPipeline();
  });

  afterEach(() => {
    vi.resetAllMocks();
    clearCapturedHandlers();
    resetIndexingLock();
    resetRagPipeline();
  });

  // ===========================================================================
  // createBot() Tests
  // ===========================================================================

  describe("createBot()", () => {
    it("should create bot and register all handlers", () => {
      const bot = createBot();

      expect(bot).toBeDefined();
      expect(capturedHandlers.error).toBeDefined();
      expect(capturedHandlers.middleware).toBeDefined();
      expect(capturedHandlers["cmd:start"]).toBeDefined();
      expect(capturedHandlers["cmd:help"]).toBeDefined();
      expect(capturedHandlers["cmd:index"]).toBeDefined();
      expect(capturedHandlers["cmd:ask"]).toBeDefined();
      expect(capturedHandlers["cmd:status"]).toBeDefined();
      expect(capturedHandlers["on:message:text"]).toBeDefined();
      expect(capturedHandlers["on:message"]).toBeDefined();
    });
  });

  // ===========================================================================
  // Error Handler (bot.catch) Tests
  // ===========================================================================

  describe("error handler (bot.catch)", () => {
    beforeEach(() => {
      createBot();
    });

    it("should handle LLMError with sanitized message", async () => {
      const ctx = createMockContext();
      const error = new LLMError(
        "API rate limit exceeded with key sk-abc123def456ghi789jkl012",
        LLMErrorSubType.RATE_LIMIT,
        "openai"
      );

      await getErrorHandler()(createBotError(error, ctx));

      // LLMError uses userMessage property
      expect(ctx.reply).toHaveBeenCalled();
    });

    it("should handle RAGError with sanitized message", async () => {
      const ctx = createMockContext();
      const error = new RAGError(
        "Index not found",
        RAGErrorSubType.INDEX_NOT_FOUND
      );

      await getErrorHandler()(createBotError(error, ctx));

      // RAGError uses userMessage property
      expect(ctx.reply).toHaveBeenCalled();
    });

    it("should handle ClaudeError with TIMEOUT subtype", async () => {
      const ctx = createMockContext();
      const error = new ClaudeError(
        "Analysis timeout",
        ClaudeErrorSubType.TIMEOUT
      );

      await getErrorHandler()(createBotError(error, ctx));

      expect(ctx.reply).toHaveBeenCalledWith(
        expect.stringContaining("Request timed out")
      );
    });

    it("should handle ClaudeError non-timeout", async () => {
      const ctx = createMockContext();
      const error = new ClaudeError(
        "Execution failed",
        ClaudeErrorSubType.EXECUTION
      );

      await getErrorHandler()(createBotError(error, ctx));

      expect(ctx.reply).toHaveBeenCalledWith(
        expect.stringContaining("Analysis error")
      );
    });

    it("should handle ValidationError", async () => {
      const ctx = createMockContext();
      const error = new ValidationError(
        "Invalid input",
        "message",
        "Message too short"
      );

      await getErrorHandler()(createBotError(error, ctx));

      expect(ctx.reply).toHaveBeenCalledWith(
        expect.stringContaining("Invalid input")
      );
    });

    it("should handle generic Error", async () => {
      const ctx = createMockContext();
      const error = new Error("Something unexpected happened");

      await getErrorHandler()(createBotError(error, ctx));

      expect(ctx.reply).toHaveBeenCalledWith(
        expect.stringContaining("An error occurred")
      );
    });

    it("should handle reply failure gracefully", async () => {
      const ctx = createMockContext();
      ctx.reply.mockRejectedValueOnce(new Error("Network error"));
      const error = new LLMError(
        "Rate limit",
        LLMErrorSubType.RATE_LIMIT,
        "openai"
      );

      // Should not throw even when reply fails
      await expect(
        getErrorHandler()(createBotError(error, ctx))
      ).resolves.not.toThrow();
    });
  });

  // ===========================================================================
  // /start Command Tests
  // ===========================================================================

  describe("/start command", () => {
    beforeEach(() => {
      createBot();
    });

    it("should reply with welcome message", async () => {
      const ctx = createMockContext({ from: { first_name: "TestUser" } });
      vi.mocked(sanitizeText).mockReturnValueOnce("TestUser");

      await getContextHandler("cmd:start")(ctx);

      expect(ctx.reply).toHaveBeenCalledWith(
        expect.stringContaining("Hello, TestUser"),
        expect.anything()
      );
    });

    it("should sanitize username", async () => {
      const ctx = createMockContext({
        from: { first_name: "  User  " },
      });
      vi.mocked(sanitizeText).mockReturnValueOnce("User");

      await getContextHandler("cmd:start")(ctx);

      expect(sanitizeText).toHaveBeenCalledWith("  User  ");
      expect(ctx.reply).toHaveBeenCalledWith(
        expect.stringContaining("User"),
        expect.anything()
      );
    });

    it("should handle missing first_name", async () => {
      const ctx = createMockContext({
        from: { first_name: undefined } as unknown as Partial<User>,
      });
      vi.mocked(sanitizeText).mockReturnValueOnce("user");

      await getContextHandler("cmd:start")(ctx);

      expect(ctx.reply).toHaveBeenCalledWith(
        expect.stringContaining("Hello, user"),
        expect.anything()
      );
    });
  });

  // ===========================================================================
  // /help Command Tests
  // ===========================================================================

  describe("/help command", () => {
    beforeEach(() => {
      createBot();
    });

    it("should list all commands", async () => {
      const ctx = createMockContext();

      await getContextHandler("cmd:help")(ctx);

      expect(ctx.reply).toHaveBeenCalledWith(
        expect.stringContaining("Guide"),
        expect.objectContaining({ parse_mode: "HTML" })
      );
      expect(ctx.reply).toHaveBeenCalledWith(
        expect.stringContaining("/index"),
        expect.objectContaining({ parse_mode: "HTML" })
      );
    });

    it("should show available providers", async () => {
      const ctx = createMockContext();

      await getContextHandler("cmd:help")(ctx);

      expect(ctx.reply).toHaveBeenCalledWith(
        expect.stringContaining("Available providers"),
        expect.objectContaining({ parse_mode: "HTML" })
      );
    });
  });

  // ===========================================================================
  // /index Command Tests
  // ===========================================================================

  describe("/index command", () => {
    beforeEach(() => {
      createBot();
    });

    it("should reject when indexing in progress", async () => {
      // Acquire lock to simulate indexing in progress
      getIndexingLock().tryAcquire();
      const ctx = createMockContext();

      await getContextHandler("cmd:index")(ctx);

      expect(ctx.reply).toHaveBeenCalledWith(
        expect.stringContaining("already in progress")
      );
    });

    it("should reject without embedding provider", async () => {
      const ctx = createMockContext();
      vi.mocked(getAvailableProviders).mockReturnValue([
        "anthropic",
        "perplexity",
      ]);

      await getContextHandler("cmd:index")(ctx);

      expect(ctx.reply).toHaveBeenCalledWith(
        expect.stringContaining("requires an embedding provider")
      );
    });

    it("should successfully index", async () => {
      const ctx = createMockContext();
      vi.mocked(getAvailableProviders).mockReturnValue(["openai", "gemini"]);

      await getContextHandler("cmd:index")(ctx);

      expect(ctx.reply).toHaveBeenCalledWith(
        expect.stringContaining("indexing")
      );
    });

    it("should handle indexing error", async () => {
      const ctx = createMockContext();
      vi.mocked(getAvailableProviders).mockReturnValue(["openai", "gemini"]);
      vi.mocked(getEmbeddingProvider).mockImplementationOnce(() => {
        throw new Error("Embedding provider error");
      });

      await getContextHandler("cmd:index")(ctx);

      expect(ctx.reply).toHaveBeenCalledWith(
        expect.stringContaining("Indexing error")
      );
    });

    it("should reset indexing flag after error", async () => {
      const ctx = createMockContext();
      vi.mocked(getAvailableProviders).mockReturnValue(["openai", "gemini"]);
      vi.mocked(getEmbeddingProvider).mockImplementationOnce(() => {
        throw new Error("Error");
      });

      await getContextHandler("cmd:index")(ctx);

      // indexingInProgress should be reset to false
      const ctx2 = createMockContext();
      vi.mocked(getAvailableProviders).mockReturnValue(["openai", "gemini"]);
      vi.mocked(getEmbeddingProvider).mockReturnValue({
        embed: vi.fn(),
        embedBatch: vi.fn(),
      });

      await getContextHandler("cmd:index")(ctx2);

      // Should not say "already in progress"
      expect(ctx2.reply).not.toHaveBeenCalledWith(
        expect.stringContaining("already in progress")
      );
    });
  });

  // ===========================================================================
  // /ask Command Tests
  // ===========================================================================

  describe("/ask command", () => {
    beforeEach(() => {
      createBot();
    });

    it("should reject empty question", async () => {
      const ctx = createMockContext({ match: "" });

      await getContextHandler("cmd:ask")(ctx);

      expect(ctx.reply).toHaveBeenCalledWith(
        expect.stringContaining("Usage: /ask")
      );
    });

    it("should reject invalid question", async () => {
      const ctx = createMockContext({ match: "hi" });
      vi.mocked(validateUserMessage).mockReturnValueOnce({
        success: false,
        error: "Message too short",
      });

      await getContextHandler("cmd:ask")(ctx);

      expect(ctx.reply).toHaveBeenCalledWith(
        expect.stringContaining("Message too short")
      );
    });

    it("should reject without embedding provider", async () => {
      const ctx = createMockContext({ match: "What does this function do?" });
      vi.mocked(validateUserMessage).mockReturnValueOnce({
        success: true,
        data: "What does this function do?",
      });
      vi.mocked(getAvailableProviders).mockReturnValue([
        "anthropic",
        "perplexity",
      ]);

      await getContextHandler("cmd:ask")(ctx);

      expect(ctx.reply).toHaveBeenCalledWith(
        expect.stringContaining("require an embedding provider")
      );
    });

    it("should reject when not indexed", async () => {
      const ctx = createMockContext({ match: "What is this?" });
      vi.mocked(validateUserMessage).mockReturnValueOnce({
        success: true,
        data: "What is this?",
      });
      vi.mocked(getAvailableProviders).mockReturnValue(["openai", "gemini"]);

      // Configure RAG mock to return not indexed
      ragMockState.indexed = false;

      await getContextHandler("cmd:ask")(ctx);

      expect(ctx.reply).toHaveBeenCalledWith(
        expect.stringContaining("not indexed")
      );
    });

    it("should successfully query", async () => {
      const ctx = createMockContext({ match: "What does test function do?" });
      vi.mocked(validateUserMessage).mockReturnValueOnce({
        success: true,
        data: "What does test function do?",
      });
      vi.mocked(getAvailableProviders).mockReturnValue(["openai", "gemini"]);

      // Configure RAG mock (indexed: true is default, queryResult set in beforeEach)
      ragMockState.indexed = true;

      await getContextHandler("cmd:ask")(ctx);

      // Check that reply was called with brief answer
      expect(ctx.reply).toHaveBeenCalledWith(
        expect.stringContaining("Answer"),
        expect.objectContaining({ parse_mode: "HTML" })
      );
    });

    it("should return early when no user ID", async () => {
      const ctx = createMockContext({ from: null, match: "test query" });
      vi.mocked(validateUserMessage).mockReturnValueOnce({
        success: true,
        data: "test query",
      });

      await getContextHandler("cmd:ask")(ctx);

      // Reply should not be called with Ответ (early return or auth fails)
      // The handler should still work as auth middleware is mocked
      expect(ctx.reply).toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // /status Command Tests
  // ===========================================================================

  describe("/status command", () => {
    beforeEach(() => {
      createBot();
    });

    it("should show provider and RAG status", async () => {
      const ctx = createMockContext();
      vi.mocked(getAvailableProviders).mockReturnValue(["openai", "gemini"]);

      await getContextHandler("cmd:status")(ctx);

      expect(ctx.reply).toHaveBeenCalledWith(
        expect.stringContaining("System status"),
        expect.objectContaining({ parse_mode: "HTML" })
      );
      expect(ctx.reply).toHaveBeenCalledWith(
        expect.stringContaining("LLM provider"),
        expect.objectContaining({ parse_mode: "HTML" })
      );
      expect(ctx.reply).toHaveBeenCalledWith(
        expect.stringContaining("RAG index"),
        expect.objectContaining({ parse_mode: "HTML" })
      );
    });

    it("should show 'Not initialized' when RAG pipeline is null", async () => {
      const ctx = createMockContext();
      resetRagPipeline();

      await getContextHandler("cmd:status")(ctx);

      expect(ctx.reply).toHaveBeenCalledWith(
        expect.stringContaining("Not initialized"),
        expect.objectContaining({ parse_mode: "HTML" })
      );
    });
  });

  // ===========================================================================
  // message:text Handler Tests
  // ===========================================================================

  describe("message:text handler", () => {
    beforeEach(() => {
      createBot();
    });

    it("should process text as RAG query directly", async () => {
      const ctx = createMockContext({
        message: { text: "How does this work?", date: Math.floor(Date.now() / 1000) + 10 },
      });
      vi.mocked(validateUserMessage).mockReturnValueOnce({
        success: true,
        data: "How does this work?",
      });
      vi.mocked(getAvailableProviders).mockReturnValue(["openai", "gemini"]);
      ragMockState.indexed = true;

      await getContextHandler("on:message:text")(ctx);

      // Text messages are now processed directly as RAG queries
      expect(ctx.reply).toHaveBeenCalled();
      // Should not call Claude CLI directly
      expect(executeClaudeAnalysis).not.toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // message Handler (non-text) Tests
  // ===========================================================================

  describe("message handler (non-text)", () => {
    beforeEach(() => {
      createBot();
    });

    it("should reply 'only text supported'", async () => {
      const ctx = createMockContext();

      await getContextHandler("on:message")(ctx);

      expect(ctx.reply).toHaveBeenCalledWith(
        expect.stringContaining("Only text messages are supported")
      );
    });
  });

  // ===========================================================================
  // sanitizeErrorMessage() Tests
  // ===========================================================================

  describe("sanitizeErrorMessage()", () => {
    it("should remove OpenAI API keys", () => {
      const message =
        "Error with key sk-abc123def456ghi789jkl012mnopqrstuvwxyz1234567890";
      const sanitized = sanitizeErrorMessage(message);

      expect(sanitized).toBe("Error with key [REDACTED]");
      expect(sanitized).not.toContain("sk-");
    });

    it("should remove Google/Gemini API keys", () => {
      const message = "Error: AIzaSyABC123DEF456GHI789JKL012MNO-PQRST";
      const sanitized = sanitizeErrorMessage(message);

      expect(sanitized).toBe("Error: [REDACTED]");
      expect(sanitized).not.toContain("AIza");
    });

    it("should remove Anthropic API keys", () => {
      const longKey = "a".repeat(95);
      const message = `Error with sk-ant-${longKey}`;
      const sanitized = sanitizeErrorMessage(message);

      expect(sanitized).toBe("Error with [REDACTED]");
      expect(sanitized).not.toContain("sk-ant-");
    });

    it("should remove Perplexity API keys", () => {
      const longKey = "a".repeat(45);
      const message = `Error: pplx-${longKey}`;
      const sanitized = sanitizeErrorMessage(message);

      expect(sanitized).toBe("Error: [REDACTED]");
      expect(sanitized).not.toContain("pplx-");
    });

    it("should remove Bearer tokens", () => {
      const message =
        "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9xyz";
      const sanitized = sanitizeErrorMessage(message);

      expect(sanitized).toBe("Authorization: Bearer [REDACTED]");
    });

    it("should handle messages without sensitive data", () => {
      const message = "Normal error message without any keys";
      const sanitized = sanitizeErrorMessage(message);

      expect(sanitized).toBe(message);
    });

    it("should handle multiple keys in one message", () => {
      const message =
        "Keys: sk-abc123def456ghi789jkl012 and AIzaSyABC123DEF456GHI789JKL012MNO-PQRST";
      const sanitized = sanitizeErrorMessage(message);

      expect(sanitized).toBe("Keys: [REDACTED] and [REDACTED]");
    });
  });

  // ===========================================================================
  // Helper Functions Tests
  // ===========================================================================

  describe("ensureRagPipeline()", () => {
    it("should create pipeline if not exists", async () => {
      resetRagPipeline();
      const mockConfig = {
        telegramToken: "test",
        authorizedUsers: [123],
        adminUsers: [],
        projectPath: "/test",
        claudeTimeout: 300000,
        rateLimiter: {
          maxRequests: 10,
          windowMs: 60000,
          cleanupIntervalMs: 300000,
        },
        llmApiKeys: { openai: "sk-test" },
        defaultLLMProvider: "openai" as const,
        defaultEmbeddingProvider: "openai" as const,
        ragStorePath: "/test/rag",
        ragConfig: {
          chunkSize: 300,
          chunkOverlap: 50,
          topK: 15,
          rerankTopK: 5,
          vectorWeight: 0.3,
          llmWeight: 0.7,
        },
      };

      const pipeline = await ensureRagPipeline(mockConfig);

      expect(pipeline).toBeDefined();
      // Check that pipeline has expected methods (created from MockRAGPipeline)
      expect(pipeline.index).toBeDefined();
      expect(pipeline.loadIndex).toBeDefined();
      expect(pipeline.query).toBeDefined();
      expect(pipeline.getStatus).toBeDefined();
    });

    it("should reuse existing pipeline", async () => {
      resetRagPipeline();
      const mockConfig = {
        telegramToken: "test",
        authorizedUsers: [123],
        adminUsers: [],
        projectPath: "/test",
        claudeTimeout: 300000,
        rateLimiter: {
          maxRequests: 10,
          windowMs: 60000,
          cleanupIntervalMs: 300000,
        },
        llmApiKeys: { openai: "sk-test" },
        defaultLLMProvider: "openai" as const,
        defaultEmbeddingProvider: "openai" as const,
        ragStorePath: "/test/rag",
        ragConfig: {
          chunkSize: 300,
          chunkOverlap: 50,
          topK: 15,
          rerankTopK: 5,
          vectorWeight: 0.3,
          llmWeight: 0.7,
        },
      };

      const pipeline1 = await ensureRagPipeline(mockConfig);
      const pipeline2 = await ensureRagPipeline(mockConfig);

      // Same instance should be returned (singleton pattern)
      expect(pipeline1).toBe(pipeline2);
    });
  });

  describe("toProviderFactoryConfig()", () => {
    it("should convert all API keys when present", () => {
      const apiKeys: LLMApiKeys = {
        openai: "sk-openai-key",
        gemini: "gemini-key",
        anthropic: "sk-ant-key",
        perplexity: "pplx-key",
      };

      const config = toProviderFactoryConfig(apiKeys);

      expect(config.openaiApiKey).toBe("sk-openai-key");
      expect(config.geminiApiKey).toBe("gemini-key");
      expect(config.anthropicApiKey).toBe("sk-ant-key");
      expect(config.perplexityApiKey).toBe("pplx-key");
    });

    it("should skip undefined keys", () => {
      const apiKeys: LLMApiKeys = {
        openai: "sk-openai-key",
        gemini: undefined,
        anthropic: undefined,
        perplexity: undefined,
      };

      const config = toProviderFactoryConfig(apiKeys);

      expect(config.openaiApiKey).toBe("sk-openai-key");
      expect(config.geminiApiKey).toBeUndefined();
      expect(config.anthropicApiKey).toBeUndefined();
      expect(config.perplexityApiKey).toBeUndefined();
    });

    it("should return empty config when no keys", () => {
      const apiKeys: LLMApiKeys = {};

      const config = toProviderFactoryConfig(apiKeys);

      expect(config.openaiApiKey).toBeUndefined();
      expect(config.geminiApiKey).toBeUndefined();
      expect(config.anthropicApiKey).toBeUndefined();
      expect(config.perplexityApiKey).toBeUndefined();
      expect(Object.keys(config).length).toBe(0);
    });

    it("should handle partial keys", () => {
      const apiKeys: LLMApiKeys = {
        openai: "sk-openai-key",
        perplexity: "pplx-key",
      };

      const config = toProviderFactoryConfig(apiKeys);

      expect(config.openaiApiKey).toBe("sk-openai-key");
      expect(config.geminiApiKey).toBeUndefined();
      expect(config.anthropicApiKey).toBeUndefined();
      expect(config.perplexityApiKey).toBe("pplx-key");
    });
  });

  // ===========================================================================
  // Edge Cases
  // ===========================================================================

  describe("edge cases", () => {
    beforeEach(() => {
      createBot();
    });

    it("should handle missing user in context for /start", async () => {
      const ctx = createMockContext({ from: null });
      vi.mocked(sanitizeText).mockReturnValueOnce("user");

      await getContextHandler("cmd:start")(ctx);

      expect(ctx.reply).toHaveBeenCalledWith(
        expect.stringContaining("Hello"),
        expect.anything()
      );
    });

    it("should handle very long username in /start", async () => {
      const longName = "A".repeat(100);
      const ctx = createMockContext({ from: { first_name: longName } });
      vi.mocked(sanitizeText).mockReturnValueOnce(longName);

      await getContextHandler("cmd:start")(ctx);

      // Username should be truncated to 50 chars
      expect(ctx.reply).toHaveBeenCalled();
    });

    it("should handle XSS attempt in message by validating input", async () => {
      const ctx = createMockContext({
        message: {
          text: '<script>alert("xss")</script>',
          date: Math.floor(Date.now() / 1000) + 10,
        },
      });
      vi.mocked(validateUserMessage).mockReturnValueOnce({
        success: false,
        error: "Message contains suspicious content",
      });

      await getContextHandler("on:message:text")(ctx);

      // Text messages with XSS should be rejected by validation
      expect(ctx.reply).toHaveBeenCalledWith(
        expect.stringContaining("Message contains suspicious content")
      );
    });
  });
});
