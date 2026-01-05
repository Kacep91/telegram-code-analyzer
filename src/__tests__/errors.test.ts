import { describe, it, expect } from "vitest";
import {
  AppError,
  ClaudeError,
  ClaudeErrorSubType,
  ValidationError,
  AuthorizationError,
  SystemError,
  SystemErrorSubType,
  TelegramError,
  FileSystemError,
  FileOperation,
  LLMError,
  LLMErrorSubType,
  RAGError,
  RAGErrorSubType,
  ErrorCategory,
  ErrorSeverity,
  isAppError,
  isClaudeError,
  isValidationError,
  isAuthorizationError,
  isSystemError,
  isTelegramError,
  isFileSystemError,
  isLLMError,
  isRAGError,
  DefaultErrorHandler,
  createDefaultErrorHandler,
} from "../errors/index.js";

// =============================================================================
// ClaudeError Tests
// =============================================================================

describe("ClaudeError", () => {
  it("creates TIMEOUT error with correct properties", () => {
    const error = new ClaudeError(
      "Analysis timed out",
      ClaudeErrorSubType.TIMEOUT
    );

    expect(error.message).toBe("Analysis timed out");
    expect(error.code).toBe("CLAUDE_ERROR");
    expect(error.category).toBe(ErrorCategory.EXTERNAL);
    expect(error.severity).toBe(ErrorSeverity.MEDIUM);
    expect(error.subType).toBe(ClaudeErrorSubType.TIMEOUT);
    expect(error.userMessage).toContain("Analysis took too long");
    expect(error.name).toBe("ClaudeError");
  });

  it("creates UNAVAILABLE error with HIGH severity", () => {
    const error = new ClaudeError(
      "CLI not found",
      ClaudeErrorSubType.UNAVAILABLE
    );

    expect(error.severity).toBe(ErrorSeverity.HIGH);
    expect(error.userMessage).toContain("Claude CLI is unavailable");
  });

  it("creates EXECUTION error with MEDIUM severity", () => {
    const error = new ClaudeError(
      "Execution failed",
      ClaudeErrorSubType.EXECUTION
    );

    expect(error.severity).toBe(ErrorSeverity.MEDIUM);
    expect(error.userMessage).toContain("Claude execution error");
  });

  it("creates PROJECT_NOT_FOUND error with HIGH severity", () => {
    const error = new ClaudeError(
      "Project path invalid",
      ClaudeErrorSubType.PROJECT_NOT_FOUND
    );

    expect(error.severity).toBe(ErrorSeverity.HIGH);
    expect(error.userMessage).toContain("Project not found");
  });

  it("stores context and originalError", () => {
    const originalError = new Error("Original cause");
    const context = { projectPath: "/some/path" };

    const error = new ClaudeError(
      "Failed",
      ClaudeErrorSubType.EXECUTION,
      context,
      originalError
    );

    expect(error.context).toEqual(context);
    expect(error.originalError).toBe(originalError);
  });
});

// =============================================================================
// ValidationError Tests
// =============================================================================

describe("ValidationError", () => {
  it("creates error with correct properties", () => {
    const error = new ValidationError(
      "Invalid query length",
      "query",
      "Query must be at least 5 characters"
    );

    expect(error.message).toBe("Invalid query length");
    expect(error.code).toBe("VALIDATION_ERROR");
    expect(error.category).toBe(ErrorCategory.USER);
    expect(error.severity).toBe(ErrorSeverity.LOW);
    expect(error.field).toBe("query");
    expect(error.userMessage).toBe("Query must be at least 5 characters");
    expect(error.name).toBe("ValidationError");
  });

  it("stores context when provided", () => {
    const context = { minLength: 5, actualLength: 2 };
    const error = new ValidationError(
      "Too short",
      "input",
      "Input too short",
      context
    );

    expect(error.context).toEqual(context);
  });
});

// =============================================================================
// AuthorizationError Tests
// =============================================================================

describe("AuthorizationError", () => {
  it("creates error with correct properties", () => {
    const error = new AuthorizationError("User not in whitelist", 123456789);

    expect(error.message).toBe("User not in whitelist");
    expect(error.code).toBe("AUTH_ERROR");
    expect(error.category).toBe(ErrorCategory.SECURITY);
    expect(error.severity).toBe(ErrorSeverity.MEDIUM);
    expect(error.userId).toBe(123456789);
    expect(error.userMessage).toContain("don't have permission");
    expect(error.name).toBe("AuthorizationError");
  });

  it("works without userId", () => {
    const error = new AuthorizationError("Unauthorized access");

    expect(error.userId).toBeUndefined();
    expect(error.message).toBe("Unauthorized access");
  });

  it("stores context when provided", () => {
    const context = { attemptedAction: "analyze" };
    const error = new AuthorizationError("Forbidden", 123, context);

    expect(error.context).toEqual(context);
  });
});

// =============================================================================
// SystemError Tests
// =============================================================================

describe("SystemError", () => {
  it("creates CONFIG error with correct properties", () => {
    const error = new SystemError(
      "Missing environment variable",
      SystemErrorSubType.CONFIG
    );

    expect(error.message).toBe("Missing environment variable");
    expect(error.code).toBe("SYSTEM_ERROR");
    expect(error.category).toBe(ErrorCategory.SYSTEM);
    expect(error.severity).toBe(ErrorSeverity.HIGH);
    expect(error.subType).toBe(SystemErrorSubType.CONFIG);
    expect(error.userMessage).toContain("System error");
    expect(error.name).toBe("SystemError");
  });

  it("creates STARTUP error", () => {
    const error = new SystemError(
      "Bot failed to start",
      SystemErrorSubType.STARTUP
    );

    expect(error.subType).toBe(SystemErrorSubType.STARTUP);
  });

  it("creates SHUTDOWN error", () => {
    const error = new SystemError(
      "Shutdown failed",
      SystemErrorSubType.SHUTDOWN
    );

    expect(error.subType).toBe(SystemErrorSubType.SHUTDOWN);
  });

  it("creates DEPENDENCY error", () => {
    const error = new SystemError(
      "Dependency missing",
      SystemErrorSubType.DEPENDENCY
    );

    expect(error.subType).toBe(SystemErrorSubType.DEPENDENCY);
  });

  it("stores context and originalError", () => {
    const originalError = new Error("Root cause");
    const context = { envVar: "BOT_TOKEN" };

    const error = new SystemError(
      "Config error",
      SystemErrorSubType.CONFIG,
      context,
      originalError
    );

    expect(error.context).toEqual(context);
    expect(error.originalError).toBe(originalError);
  });
});

// =============================================================================
// TelegramError Tests
// =============================================================================

describe("TelegramError", () => {
  it("creates error with correct properties", () => {
    const error = new TelegramError("API call failed", 400);

    expect(error.message).toBe("API call failed");
    expect(error.code).toBe("TELEGRAM_ERROR");
    expect(error.category).toBe(ErrorCategory.EXTERNAL);
    expect(error.severity).toBe(ErrorSeverity.MEDIUM);
    expect(error.botApiCode).toBe(400);
    expect(error.userMessage).toContain("Telegram connection error");
    expect(error.name).toBe("TelegramError");
  });

  it("works without botApiCode", () => {
    const error = new TelegramError("Network error");

    expect(error.botApiCode).toBeUndefined();
  });

  it("stores context and originalError", () => {
    const originalError = new Error("Network timeout");
    const context = { endpoint: "sendMessage" };

    const error = new TelegramError(
      "Request failed",
      500,
      context,
      originalError
    );

    expect(error.context).toEqual(context);
    expect(error.originalError).toBe(originalError);
  });
});

// =============================================================================
// FileSystemError Tests
// =============================================================================

describe("FileSystemError", () => {
  it("creates READ error with correct properties", () => {
    const error = new FileSystemError(
      "Cannot read file",
      FileOperation.READ,
      "/tmp/test.md"
    );

    expect(error.message).toBe("Cannot read file");
    expect(error.code).toBe("FS_ERROR");
    expect(error.category).toBe(ErrorCategory.SYSTEM);
    expect(error.severity).toBe(ErrorSeverity.MEDIUM);
    expect(error.operation).toBe(FileOperation.READ);
    expect(error.path).toBe("/tmp/test.md");
    expect(error.userMessage).toContain("File system error");
    expect(error.name).toBe("FileSystemError");
  });

  it("creates WRITE error", () => {
    const error = new FileSystemError("Write failed", FileOperation.WRITE);

    expect(error.operation).toBe(FileOperation.WRITE);
    expect(error.path).toBeUndefined();
  });

  it("creates DELETE error", () => {
    const error = new FileSystemError(
      "Delete failed",
      FileOperation.DELETE,
      "/path/to/file"
    );

    expect(error.operation).toBe(FileOperation.DELETE);
  });

  it("creates CREATE error", () => {
    const error = new FileSystemError("Create failed", FileOperation.CREATE);

    expect(error.operation).toBe(FileOperation.CREATE);
  });

  it("creates ACCESS error", () => {
    const error = new FileSystemError("Access denied", FileOperation.ACCESS);

    expect(error.operation).toBe(FileOperation.ACCESS);
  });

  it("stores context and originalError", () => {
    const originalError = new Error("ENOENT");
    const context = { mode: "r" };

    const error = new FileSystemError(
      "File not found",
      FileOperation.READ,
      "/path",
      context,
      originalError
    );

    expect(error.context).toEqual(context);
    expect(error.originalError).toBe(originalError);
  });
});

// =============================================================================
// LLMError Tests
// =============================================================================

describe("LLMError", () => {
  it("creates RATE_LIMIT error with correct properties", () => {
    const error = new LLMError(
      "Rate limit exceeded",
      LLMErrorSubType.RATE_LIMIT,
      "openai"
    );

    expect(error.message).toBe("Rate limit exceeded");
    expect(error.code).toBe("LLM_ERROR");
    expect(error.category).toBe(ErrorCategory.EXTERNAL);
    expect(error.severity).toBe(ErrorSeverity.MEDIUM);
    expect(error.subType).toBe(LLMErrorSubType.RATE_LIMIT);
    expect(error.provider).toBe("openai");
    expect(error.userMessage).toContain("openai rate limit exceeded");
    expect(error.name).toBe("LLMError");
  });

  it("creates INVALID_KEY error with HIGH severity", () => {
    const error = new LLMError(
      "Invalid API key",
      LLMErrorSubType.INVALID_KEY,
      "anthropic"
    );

    expect(error.severity).toBe(ErrorSeverity.HIGH);
    expect(error.userMessage).toContain("Invalid anthropic API key");
  });

  it("creates MODEL_UNAVAILABLE error", () => {
    const error = new LLMError(
      "Model not found",
      LLMErrorSubType.MODEL_UNAVAILABLE,
      "gemini"
    );

    expect(error.severity).toBe(ErrorSeverity.MEDIUM);
    expect(error.userMessage).toContain("gemini model unavailable");
  });

  it("creates TIMEOUT error", () => {
    const error = new LLMError(
      "Request timed out",
      LLMErrorSubType.TIMEOUT,
      "openai"
    );

    expect(error.severity).toBe(ErrorSeverity.MEDIUM);
    expect(error.userMessage).toContain("openai request timed out");
  });

  it("creates EMBEDDING_FAILED error", () => {
    const error = new LLMError(
      "Embedding failed",
      LLMErrorSubType.EMBEDDING_FAILED,
      "openai"
    );

    expect(error.severity).toBe(ErrorSeverity.MEDIUM);
    expect(error.userMessage).toContain("embedding generation failed");
  });

  it("creates COMPLETION_FAILED error", () => {
    const error = new LLMError(
      "Completion failed",
      LLMErrorSubType.COMPLETION_FAILED,
      "anthropic"
    );

    expect(error.severity).toBe(ErrorSeverity.MEDIUM);
    expect(error.userMessage).toContain("completion failed");
  });

  it("creates API_ERROR with default handling", () => {
    const error = new LLMError(
      "API error",
      LLMErrorSubType.API_ERROR,
      "perplexity"
    );

    expect(error.severity).toBe(ErrorSeverity.MEDIUM);
    expect(error.userMessage).toContain("perplexity error");
  });

  it("stores context and originalError", () => {
    const originalError = new Error("Network failure");
    const context = { retryAfter: 60 };

    const error = new LLMError(
      "Rate limited",
      LLMErrorSubType.RATE_LIMIT,
      "openai",
      context,
      originalError
    );

    expect(error.context).toEqual(context);
    expect(error.originalError).toBe(originalError);
  });
});

// =============================================================================
// RAGError Tests
// =============================================================================

describe("RAGError", () => {
  it("creates INDEX_NOT_FOUND error with correct properties", () => {
    const error = new RAGError(
      "Index file missing",
      RAGErrorSubType.INDEX_NOT_FOUND
    );

    expect(error.message).toBe("Index file missing");
    expect(error.code).toBe("RAG_ERROR");
    expect(error.category).toBe(ErrorCategory.SYSTEM);
    expect(error.severity).toBe(ErrorSeverity.MEDIUM);
    expect(error.subType).toBe(RAGErrorSubType.INDEX_NOT_FOUND);
    expect(error.userMessage).toContain("Code index not found");
    expect(error.name).toBe("RAGError");
  });

  it("creates INDEX_CORRUPTED error with HIGH severity", () => {
    const error = new RAGError(
      "Invalid index format",
      RAGErrorSubType.INDEX_CORRUPTED
    );

    expect(error.severity).toBe(ErrorSeverity.HIGH);
    expect(error.userMessage).toContain("Code index corrupted");
  });

  it("creates INDEXING_FAILED error with HIGH severity", () => {
    const error = new RAGError(
      "Indexing failed",
      RAGErrorSubType.INDEXING_FAILED
    );

    expect(error.severity).toBe(ErrorSeverity.HIGH);
    expect(error.userMessage).toContain("Failed to index codebase");
  });

  it("creates QUERY_FAILED error", () => {
    const error = new RAGError(
      "Query execution failed",
      RAGErrorSubType.QUERY_FAILED
    );

    expect(error.severity).toBe(ErrorSeverity.MEDIUM);
    expect(error.userMessage).toContain("Query failed");
  });

  it("creates NO_RESULTS error with LOW severity", () => {
    const error = new RAGError(
      "No matching documents",
      RAGErrorSubType.NO_RESULTS
    );

    expect(error.severity).toBe(ErrorSeverity.LOW);
    expect(error.userMessage).toContain("No relevant code found");
  });

  it("creates EMBEDDING_FAILED error", () => {
    const error = new RAGError(
      "Embedding generation failed",
      RAGErrorSubType.EMBEDDING_FAILED
    );

    expect(error.severity).toBe(ErrorSeverity.MEDIUM);
    expect(error.userMessage).toContain("Failed to generate embeddings");
  });

  it("stores context and originalError", () => {
    const originalError = new Error("File read error");
    const context = { path: "/data/index.json" };

    const error = new RAGError(
      "Index load failed",
      RAGErrorSubType.INDEX_NOT_FOUND,
      context,
      originalError
    );

    expect(error.context).toEqual(context);
    expect(error.originalError).toBe(originalError);
  });
});

// =============================================================================
// Type Guards Tests
// =============================================================================

describe("Type Guards", () => {
  const claudeError = new ClaudeError("test", ClaudeErrorSubType.TIMEOUT);
  const validationError = new ValidationError("test", "field", "msg");
  const authError = new AuthorizationError("test");
  const systemError = new SystemError("test", SystemErrorSubType.CONFIG);
  const telegramError = new TelegramError("test");
  const fsError = new FileSystemError("test", FileOperation.READ);
  const llmError = new LLMError("test", LLMErrorSubType.API_ERROR, "openai");
  const ragError = new RAGError("test", RAGErrorSubType.INDEX_NOT_FOUND);
  const standardError = new Error("standard error");

  describe("isAppError", () => {
    it("returns true for all AppError subclasses", () => {
      expect(isAppError(claudeError)).toBe(true);
      expect(isAppError(validationError)).toBe(true);
      expect(isAppError(authError)).toBe(true);
      expect(isAppError(systemError)).toBe(true);
      expect(isAppError(telegramError)).toBe(true);
      expect(isAppError(fsError)).toBe(true);
      expect(isAppError(llmError)).toBe(true);
      expect(isAppError(ragError)).toBe(true);
    });

    it("returns false for standard Error", () => {
      expect(isAppError(standardError)).toBe(false);
    });

    it("returns false for non-errors", () => {
      expect(isAppError(null)).toBe(false);
      expect(isAppError(undefined)).toBe(false);
      expect(isAppError("string")).toBe(false);
      expect(isAppError(123)).toBe(false);
      expect(isAppError({})).toBe(false);
    });
  });

  describe("isClaudeError", () => {
    it("returns true for ClaudeError", () => {
      expect(isClaudeError(claudeError)).toBe(true);
    });

    it("returns false for other error types", () => {
      expect(isClaudeError(validationError)).toBe(false);
      expect(isClaudeError(authError)).toBe(false);
      expect(isClaudeError(standardError)).toBe(false);
      expect(isClaudeError(null)).toBe(false);
    });
  });

  describe("isValidationError", () => {
    it("returns true for ValidationError", () => {
      expect(isValidationError(validationError)).toBe(true);
    });

    it("returns false for other error types", () => {
      expect(isValidationError(claudeError)).toBe(false);
      expect(isValidationError(authError)).toBe(false);
      expect(isValidationError(standardError)).toBe(false);
      expect(isValidationError(null)).toBe(false);
    });
  });

  describe("isAuthorizationError", () => {
    it("returns true for AuthorizationError", () => {
      expect(isAuthorizationError(authError)).toBe(true);
    });

    it("returns false for other error types", () => {
      expect(isAuthorizationError(claudeError)).toBe(false);
      expect(isAuthorizationError(validationError)).toBe(false);
      expect(isAuthorizationError(standardError)).toBe(false);
      expect(isAuthorizationError(null)).toBe(false);
    });
  });

  describe("isSystemError", () => {
    it("returns true for SystemError", () => {
      expect(isSystemError(systemError)).toBe(true);
    });

    it("returns false for other error types", () => {
      expect(isSystemError(claudeError)).toBe(false);
      expect(isSystemError(telegramError)).toBe(false);
      expect(isSystemError(standardError)).toBe(false);
      expect(isSystemError(null)).toBe(false);
    });
  });

  describe("isTelegramError", () => {
    it("returns true for TelegramError", () => {
      expect(isTelegramError(telegramError)).toBe(true);
    });

    it("returns false for other error types", () => {
      expect(isTelegramError(claudeError)).toBe(false);
      expect(isTelegramError(systemError)).toBe(false);
      expect(isTelegramError(standardError)).toBe(false);
      expect(isTelegramError(null)).toBe(false);
    });
  });

  describe("isFileSystemError", () => {
    it("returns true for FileSystemError", () => {
      expect(isFileSystemError(fsError)).toBe(true);
    });

    it("returns false for other error types", () => {
      expect(isFileSystemError(claudeError)).toBe(false);
      expect(isFileSystemError(systemError)).toBe(false);
      expect(isFileSystemError(standardError)).toBe(false);
      expect(isFileSystemError(null)).toBe(false);
    });
  });

  describe("isLLMError", () => {
    it("returns true for LLMError", () => {
      expect(isLLMError(llmError)).toBe(true);
    });

    it("returns false for other error types", () => {
      expect(isLLMError(claudeError)).toBe(false);
      expect(isLLMError(ragError)).toBe(false);
      expect(isLLMError(standardError)).toBe(false);
      expect(isLLMError(null)).toBe(false);
    });
  });

  describe("isRAGError", () => {
    it("returns true for RAGError", () => {
      expect(isRAGError(ragError)).toBe(true);
    });

    it("returns false for other error types", () => {
      expect(isRAGError(claudeError)).toBe(false);
      expect(isRAGError(llmError)).toBe(false);
      expect(isRAGError(standardError)).toBe(false);
      expect(isRAGError(null)).toBe(false);
    });
  });
});

// =============================================================================
// DefaultErrorHandler Tests
// =============================================================================

describe("DefaultErrorHandler", () => {
  const handler = new DefaultErrorHandler();

  describe("handle() with AppError subclasses", () => {
    it("handles ClaudeError with MEDIUM severity (shouldRetry=true)", () => {
      const error = new ClaudeError("timeout", ClaudeErrorSubType.TIMEOUT);
      const result = handler.handle(error);

      expect(result.userMessage).toBe(error.userMessage);
      expect(result.shouldRetry).toBe(true);
    });

    it("handles ClaudeError with HIGH severity (shouldRetry=false)", () => {
      const error = new ClaudeError(
        "unavailable",
        ClaudeErrorSubType.UNAVAILABLE
      );
      const result = handler.handle(error);

      expect(result.userMessage).toBe(error.userMessage);
      expect(result.shouldRetry).toBe(false);
    });

    it("handles ValidationError with LOW severity (shouldRetry=true)", () => {
      const error = new ValidationError("invalid", "query", "Invalid query");
      const result = handler.handle(error);

      expect(result.userMessage).toBe("Invalid query");
      expect(result.shouldRetry).toBe(true);
    });

    it("handles AuthorizationError with MEDIUM severity (shouldRetry=true)", () => {
      const error = new AuthorizationError("forbidden");
      const result = handler.handle(error);

      expect(result.userMessage).toContain("don't have permission");
      expect(result.shouldRetry).toBe(true);
    });

    it("handles SystemError with HIGH severity (shouldRetry=false)", () => {
      const error = new SystemError(
        "config missing",
        SystemErrorSubType.CONFIG
      );
      const result = handler.handle(error);

      expect(result.userMessage).toContain("System error");
      expect(result.shouldRetry).toBe(false);
    });

    it("handles TelegramError with MEDIUM severity (shouldRetry=true)", () => {
      const error = new TelegramError("API error", 500);
      const result = handler.handle(error);

      expect(result.userMessage).toContain("Telegram connection error");
      expect(result.shouldRetry).toBe(true);
    });

    it("handles FileSystemError with MEDIUM severity (shouldRetry=true)", () => {
      const error = new FileSystemError("read failed", FileOperation.READ);
      const result = handler.handle(error);

      expect(result.userMessage).toContain("File system error");
      expect(result.shouldRetry).toBe(true);
    });

    it("handles LLMError with MEDIUM severity (shouldRetry=true)", () => {
      const error = new LLMError(
        "rate limit",
        LLMErrorSubType.RATE_LIMIT,
        "openai"
      );
      const result = handler.handle(error);

      expect(result.userMessage).toContain("rate limit exceeded");
      expect(result.shouldRetry).toBe(true);
    });

    it("handles LLMError with HIGH severity (shouldRetry=false)", () => {
      const error = new LLMError(
        "invalid key",
        LLMErrorSubType.INVALID_KEY,
        "openai"
      );
      const result = handler.handle(error);

      expect(result.userMessage).toContain("Invalid openai API key");
      expect(result.shouldRetry).toBe(false);
    });

    it("handles RAGError with LOW severity (shouldRetry=true)", () => {
      const error = new RAGError("no results", RAGErrorSubType.NO_RESULTS);
      const result = handler.handle(error);

      expect(result.userMessage).toContain("No relevant code found");
      expect(result.shouldRetry).toBe(true);
    });

    it("handles RAGError with HIGH severity (shouldRetry=false)", () => {
      const error = new RAGError(
        "index corrupted",
        RAGErrorSubType.INDEX_CORRUPTED
      );
      const result = handler.handle(error);

      expect(result.userMessage).toContain("Code index corrupted");
      expect(result.shouldRetry).toBe(false);
    });
  });

  describe("handle() with standard Error", () => {
    it("returns generic message with shouldRetry=true", () => {
      const error = new Error("Something went wrong");
      const result = handler.handle(error);

      expect(result.userMessage).toContain("An error occurred");
      expect(result.shouldRetry).toBe(true);
    });
  });

  describe("handle() with non-Error values", () => {
    it("returns unknown error message with shouldRetry=false for null", () => {
      const result = handler.handle(null);

      expect(result.userMessage).toContain("Unknown error");
      expect(result.shouldRetry).toBe(false);
    });

    it("returns unknown error message with shouldRetry=false for undefined", () => {
      const result = handler.handle(undefined);

      expect(result.userMessage).toContain("Unknown error");
      expect(result.shouldRetry).toBe(false);
    });

    it("returns unknown error message with shouldRetry=false for string", () => {
      const result = handler.handle("error string");

      expect(result.userMessage).toContain("Unknown error");
      expect(result.shouldRetry).toBe(false);
    });

    it("returns unknown error message with shouldRetry=false for number", () => {
      const result = handler.handle(500);

      expect(result.userMessage).toContain("Unknown error");
      expect(result.shouldRetry).toBe(false);
    });

    it("returns unknown error message with shouldRetry=false for object", () => {
      const result = handler.handle({ error: true });

      expect(result.userMessage).toContain("Unknown error");
      expect(result.shouldRetry).toBe(false);
    });
  });
});

describe("createDefaultErrorHandler", () => {
  it("returns a DefaultErrorHandler instance", () => {
    const handler = createDefaultErrorHandler();

    expect(handler).toBeInstanceOf(DefaultErrorHandler);
  });

  it("returned handler works correctly", () => {
    const handler = createDefaultErrorHandler();
    const error = new ClaudeError("test", ClaudeErrorSubType.TIMEOUT);
    const result = handler.handle(error);

    expect(result.userMessage).toBe(error.userMessage);
    expect(result.shouldRetry).toBe(true);
  });
});

// =============================================================================
// Error Inheritance Tests
// =============================================================================

describe("Error Inheritance", () => {
  it("all error classes extend AppError", () => {
    const errors = [
      new ClaudeError("test", ClaudeErrorSubType.TIMEOUT),
      new ValidationError("test", "field", "msg"),
      new AuthorizationError("test"),
      new SystemError("test", SystemErrorSubType.CONFIG),
      new TelegramError("test"),
      new FileSystemError("test", FileOperation.READ),
      new LLMError("test", LLMErrorSubType.API_ERROR, "provider"),
      new RAGError("test", RAGErrorSubType.INDEX_NOT_FOUND),
    ];

    for (const error of errors) {
      expect(error).toBeInstanceOf(AppError);
      expect(error).toBeInstanceOf(Error);
    }
  });

  it("all error classes have name property set correctly", () => {
    expect(new ClaudeError("t", ClaudeErrorSubType.TIMEOUT).name).toBe(
      "ClaudeError"
    );
    expect(new ValidationError("t", "f", "m").name).toBe("ValidationError");
    expect(new AuthorizationError("t").name).toBe("AuthorizationError");
    expect(new SystemError("t", SystemErrorSubType.CONFIG).name).toBe(
      "SystemError"
    );
    expect(new TelegramError("t").name).toBe("TelegramError");
    expect(new FileSystemError("t", FileOperation.READ).name).toBe(
      "FileSystemError"
    );
    expect(new LLMError("t", LLMErrorSubType.API_ERROR, "p").name).toBe(
      "LLMError"
    );
    expect(new RAGError("t", RAGErrorSubType.INDEX_NOT_FOUND).name).toBe(
      "RAGError"
    );
  });

  it("all error classes have stack trace", () => {
    const errors = [
      new ClaudeError("test", ClaudeErrorSubType.TIMEOUT),
      new ValidationError("test", "field", "msg"),
      new AuthorizationError("test"),
      new SystemError("test", SystemErrorSubType.CONFIG),
      new TelegramError("test"),
      new FileSystemError("test", FileOperation.READ),
      new LLMError("test", LLMErrorSubType.API_ERROR, "provider"),
      new RAGError("test", RAGErrorSubType.INDEX_NOT_FOUND),
    ];

    for (const error of errors) {
      expect(error.stack).toBeDefined();
      expect(typeof error.stack).toBe("string");
    }
  });
});
