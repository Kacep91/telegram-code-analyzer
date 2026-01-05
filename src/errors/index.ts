export abstract class AppError extends Error {
  abstract readonly code: string;
  abstract readonly category: ErrorCategory;
  abstract readonly severity: ErrorSeverity;
  abstract readonly userMessage: string;

  constructor(
    message: string,
    public readonly context?: Record<string, unknown>,
    public readonly originalError?: Error
  ) {
    super(message);
    this.name = this.constructor.name;

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

export class ClaudeError extends AppError {
  readonly code = "CLAUDE_ERROR";
  readonly category = ErrorCategory.EXTERNAL;
  readonly severity: ErrorSeverity;
  readonly userMessage: string;

  constructor(
    message: string,
    public readonly subType: ClaudeErrorSubType,
    context?: Record<string, unknown>,
    originalError?: Error
  ) {
    super(message, context, originalError);

    switch (subType) {
      case ClaudeErrorSubType.TIMEOUT:
        this.severity = ErrorSeverity.MEDIUM;
        this.userMessage =
          "⏰ Analysis took too long. Please try to formulate your question more specifically.";
        break;
      case ClaudeErrorSubType.UNAVAILABLE:
        this.severity = ErrorSeverity.HIGH;
        this.userMessage =
          "🤖 Claude CLI is unavailable. Contact administrator.";
        break;
      case ClaudeErrorSubType.EXECUTION:
        this.severity = ErrorSeverity.MEDIUM;
        this.userMessage =
          "🤖 Claude execution error. Try rephrasing your question.";
        break;
      case ClaudeErrorSubType.PROJECT_NOT_FOUND:
        this.severity = ErrorSeverity.HIGH;
        this.userMessage = "📁 Project not found. Check project path settings.";
        break;
    }
  }
}

/** Input validation errors */
export class ValidationError extends AppError {
  readonly code = "VALIDATION_ERROR";
  readonly category = ErrorCategory.USER;
  readonly severity = ErrorSeverity.LOW;

  constructor(
    message: string,
    public readonly field: string,
    public readonly userMessage: string,
    context?: Record<string, unknown>
  ) {
    super(message, context);
  }
}

/** Authorization and authentication errors */
export class AuthorizationError extends AppError {
  readonly code = "AUTH_ERROR";
  readonly category = ErrorCategory.SECURITY;
  readonly severity = ErrorSeverity.MEDIUM;
  readonly userMessage = "🚫 You don't have permission to perform this action.";

  constructor(
    message: string,
    public readonly userId?: number,
    context?: Record<string, unknown>
  ) {
    super(message, context);
  }
}

/** System and configuration errors */
export class SystemError extends AppError {
  readonly code = "SYSTEM_ERROR";
  readonly category = ErrorCategory.SYSTEM;
  readonly severity = ErrorSeverity.HIGH;
  readonly userMessage = "🔧 System error. Contact administrator.";

  constructor(
    message: string,
    public readonly subType: SystemErrorSubType,
    context?: Record<string, unknown>,
    originalError?: Error
  ) {
    super(message, context, originalError);
  }
}

/** Telegram Bot API errors */
export class TelegramError extends AppError {
  readonly code = "TELEGRAM_ERROR";
  readonly category = ErrorCategory.EXTERNAL;
  readonly severity = ErrorSeverity.MEDIUM;
  readonly userMessage =
    "📨 Telegram connection error. Please try again later.";

  constructor(
    message: string,
    public readonly botApiCode?: number,
    context?: Record<string, unknown>,
    originalError?: Error
  ) {
    super(message, context, originalError);
  }
}

/** File system operation errors */
export class FileSystemError extends AppError {
  readonly code = "FS_ERROR";
  readonly category = ErrorCategory.SYSTEM;
  readonly severity = ErrorSeverity.MEDIUM;
  readonly userMessage = "📁 File system error. Please try again later.";

  constructor(
    message: string,
    public readonly operation: FileOperation,
    public readonly path?: string,
    context?: Record<string, unknown>,
    originalError?: Error
  ) {
    super(message, context, originalError);
  }
}

export enum ErrorCategory {
  USER = "user", // User input errors
  SYSTEM = "system", // System/infrastructure errors
  EXTERNAL = "external", // External service errors
  SECURITY = "security", // Authorization/security errors
}

export enum ErrorSeverity {
  LOW = "low", // User can continue, minor issue
  MEDIUM = "medium", // Feature unavailable, retry possible
  HIGH = "high", // Service unavailable, admin needed
  CRITICAL = "critical", // Complete failure, immediate attention
}

export enum ClaudeErrorSubType {
  TIMEOUT = "timeout",
  UNAVAILABLE = "unavailable",
  EXECUTION = "execution",
  PROJECT_NOT_FOUND = "project_not_found",
}

export enum SystemErrorSubType {
  CONFIG = "config",
  STARTUP = "startup",
  SHUTDOWN = "shutdown",
  DEPENDENCY = "dependency",
}

export enum FileOperation {
  READ = "read",
  WRITE = "write",
  DELETE = "delete",
  CREATE = "create",
  ACCESS = "access",
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

export function isClaudeError(error: unknown): error is ClaudeError {
  return error instanceof ClaudeError;
}

export function isValidationError(error: unknown): error is ValidationError {
  return error instanceof ValidationError;
}

export function isAuthorizationError(
  error: unknown
): error is AuthorizationError {
  return error instanceof AuthorizationError;
}

export function isSystemError(error: unknown): error is SystemError {
  return error instanceof SystemError;
}

export function isTelegramError(error: unknown): error is TelegramError {
  return error instanceof TelegramError;
}

export function isFileSystemError(error: unknown): error is FileSystemError {
  return error instanceof FileSystemError;
}

// =============================================================================
// LLM Provider Errors
// =============================================================================

/**
 * Sub-types for LLM provider errors
 * @remarks Used to categorize different LLM failure modes
 */
export enum LLMErrorSubType {
  API_ERROR = "api_error",
  RATE_LIMIT = "rate_limit",
  INVALID_KEY = "invalid_key",
  MODEL_UNAVAILABLE = "model_unavailable",
  TIMEOUT = "timeout",
  EMBEDDING_FAILED = "embedding_failed",
  COMPLETION_FAILED = "completion_failed",
}

/**
 * LLM Provider error for API and service issues
 * @remarks Handles various LLM-specific failure scenarios with user-friendly messages
 *
 * @example
 * ```typescript
 * throw new LLMError(
 *   "OpenAI API returned 429",
 *   LLMErrorSubType.RATE_LIMIT,
 *   "openai",
 *   { retryAfter: 60 }
 * );
 * ```
 */
export class LLMError extends AppError {
  readonly code = "LLM_ERROR";
  readonly category = ErrorCategory.EXTERNAL;
  readonly severity: ErrorSeverity;
  readonly userMessage: string;

  constructor(
    message: string,
    public readonly subType: LLMErrorSubType,
    public readonly provider: string,
    context?: Record<string, unknown>,
    originalError?: Error
  ) {
    super(message, context, originalError);

    switch (subType) {
      case LLMErrorSubType.RATE_LIMIT:
        this.severity = ErrorSeverity.MEDIUM;
        this.userMessage = `${provider} rate limit exceeded. Please wait a moment.`;
        break;
      case LLMErrorSubType.INVALID_KEY:
        this.severity = ErrorSeverity.HIGH;
        this.userMessage = `Invalid ${provider} API key. Contact administrator.`;
        break;
      case LLMErrorSubType.MODEL_UNAVAILABLE:
        this.severity = ErrorSeverity.MEDIUM;
        this.userMessage = `${provider} model unavailable. Try a different provider.`;
        break;
      case LLMErrorSubType.TIMEOUT:
        this.severity = ErrorSeverity.MEDIUM;
        this.userMessage = `${provider} request timed out. Please try again.`;
        break;
      case LLMErrorSubType.EMBEDDING_FAILED:
        this.severity = ErrorSeverity.MEDIUM;
        this.userMessage = `${provider} embedding generation failed. Please try again.`;
        break;
      case LLMErrorSubType.COMPLETION_FAILED:
        this.severity = ErrorSeverity.MEDIUM;
        this.userMessage = `${provider} completion failed. Please try again.`;
        break;
      case LLMErrorSubType.API_ERROR:
      default:
        this.severity = ErrorSeverity.MEDIUM;
        this.userMessage = `${provider} error. Please try again later.`;
    }
  }
}

/**
 * Type guard for LLMError
 * @param error - Unknown error to check
 * @returns True if error is LLMError instance
 */
export function isLLMError(error: unknown): error is LLMError {
  return error instanceof LLMError;
}

// =============================================================================
// RAG Pipeline Errors
// =============================================================================

/**
 * Sub-types for RAG pipeline errors
 * @remarks Used to categorize different RAG failure modes
 */
export enum RAGErrorSubType {
  INDEX_NOT_FOUND = "index_not_found",
  INDEX_CORRUPTED = "index_corrupted",
  INDEXING_FAILED = "indexing_failed",
  QUERY_FAILED = "query_failed",
  NO_RESULTS = "no_results",
  EMBEDDING_FAILED = "embedding_failed",
}

/**
 * RAG Pipeline error for indexing and query issues
 * @remarks Handles various RAG-specific failure scenarios with user-friendly messages
 *
 * @example
 * ```typescript
 * throw new RAGError(
 *   "Index file not found at path",
 *   RAGErrorSubType.INDEX_NOT_FOUND,
 *   { path: "/data/index.json" }
 * );
 * ```
 */
export class RAGError extends AppError {
  readonly code = "RAG_ERROR";
  readonly category = ErrorCategory.SYSTEM;
  readonly severity: ErrorSeverity;
  readonly userMessage: string;

  constructor(
    message: string,
    public readonly subType: RAGErrorSubType,
    context?: Record<string, unknown>,
    originalError?: Error
  ) {
    super(message, context, originalError);

    switch (subType) {
      case RAGErrorSubType.INDEX_NOT_FOUND:
        this.severity = ErrorSeverity.MEDIUM;
        this.userMessage = "Code index not found. Use /index to create one.";
        break;
      case RAGErrorSubType.INDEX_CORRUPTED:
        this.severity = ErrorSeverity.HIGH;
        this.userMessage = "Code index corrupted. Please re-index with /index.";
        break;
      case RAGErrorSubType.INDEXING_FAILED:
        this.severity = ErrorSeverity.HIGH;
        this.userMessage = "Failed to index codebase. Check project path.";
        break;
      case RAGErrorSubType.QUERY_FAILED:
        this.severity = ErrorSeverity.MEDIUM;
        this.userMessage = "Query failed. Please try again.";
        break;
      case RAGErrorSubType.NO_RESULTS:
        this.severity = ErrorSeverity.LOW;
        this.userMessage =
          "No relevant code found. Try rephrasing your question.";
        break;
      case RAGErrorSubType.EMBEDDING_FAILED:
        this.severity = ErrorSeverity.MEDIUM;
        this.userMessage = "Failed to generate embeddings. Check LLM provider.";
        break;
    }
  }
}

/**
 * Type guard for RAGError
 * @param error - Unknown error to check
 * @returns True if error is RAGError instance
 */
export function isRAGError(error: unknown): error is RAGError {
  return error instanceof RAGError;
}

export interface SimpleErrorHandler {
  handle(error: unknown): { userMessage: string; shouldRetry: boolean };
}

export class DefaultErrorHandler implements SimpleErrorHandler {
  handle(error: unknown): { userMessage: string; shouldRetry: boolean } {
    if (isAppError(error)) {
      return {
        userMessage: error.userMessage,
        shouldRetry:
          error.severity === ErrorSeverity.LOW ||
          error.severity === ErrorSeverity.MEDIUM,
      };
    }

    if (error instanceof Error) {
      return {
        userMessage: "⚠️ An error occurred. Please try again.",
        shouldRetry: true,
      };
    }

    return {
      userMessage: "❌ Unknown error. Contact administrator.",
      shouldRetry: false,
    };
  }
}

export function createDefaultErrorHandler(): SimpleErrorHandler {
  return new DefaultErrorHandler();
}
