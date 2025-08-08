/**
 * Types and interfaces for centralized error handling system
 */

import { AppError, ErrorCategory, ErrorSeverity } from "./index.js";

/** Error handling result */
export interface ErrorHandleResult {
  /** Error was handled successfully */
  handled: boolean;
  /** User-friendly message to display */
  userMessage: string;
  /** Whether to retry the operation */
  shouldRetry: boolean;
  /** Recovery action was attempted */
  recoveryAttempted: boolean;
  /** File path for detailed error report (if created) */
  reportFilePath?: string;
}

/** Error recovery strategy result */
export interface RecoveryResult {
  /** Recovery was successful */
  success: boolean;
  /** Message about recovery attempt */
  message: string;
  /** Modified error (if recovery changed error state) */
  modifiedError?: AppError;
}

/** Error reporting metadata */
export interface ErrorReport {
  /** Error instance */
  error: AppError;
  /** When error occurred */
  timestamp: Date;
  /** Context where error occurred */
  context: ErrorContext;
  /** Recovery attempts made */
  recoveryAttempts: RecoveryAttempt[];
  /** Error resolved or still active */
  resolved: boolean;
}

/** Context information for error occurrence */
export interface ErrorContext {
  /** Component/module where error occurred */
  component: string;
  /** Specific operation being performed */
  operation: string;
  /** User ID (if applicable) */
  userId?: number;
  /** Request/message ID (if applicable) */
  requestId?: string;
  /** Additional context data */
  metadata?: Record<string, unknown>;
}

/** Recovery attempt record */
export interface RecoveryAttempt {
  /** Recovery strategy used */
  strategy: string;
  /** When attempt was made */
  timestamp: Date;
  /** Result of recovery attempt */
  result: RecoveryResult;
}

/** Error handler interface */
export interface IErrorHandler {
  /** Handle an error with context */
  handle(error: unknown, context: ErrorContext): Promise<ErrorHandleResult>;

  /** Get error reports for monitoring */
  getReports(filter?: ErrorReportFilter): ErrorReport[];

  /** Clear resolved error reports */
  clearResolvedReports(): void;
}

/** Error recovery strategy interface */
export interface IRecoveryStrategy {
  /** Strategy name */
  readonly name: string;

  /** Check if strategy can handle this error type */
  canHandle(error: AppError): boolean;

  /** Attempt recovery */
  recover(error: AppError, context: ErrorContext): Promise<RecoveryResult>;
}

/** Error report filter options */
export interface ErrorReportFilter {
  /** Filter by category */
  category?: ErrorCategory;
  /** Filter by severity */
  severity?: ErrorSeverity;
  /** Filter by component */
  component?: string;
  /** Filter by time range */
  timeRange?: {
    from: Date;
    to: Date;
  };
  /** Only unresolved errors */
  unresolvedOnly?: boolean;
}

/** Error metrics for monitoring */
export interface ErrorMetrics {
  /** Total errors in time period */
  total: number;
  /** Errors by category */
  byCategory: Record<ErrorCategory, number>;
  /** Errors by severity */
  bySeverity: Record<ErrorSeverity, number>;
  /** Errors by component */
  byComponent: Record<string, number>;
  /** Recovery success rate */
  recoverySuccessRate: number;
}

/** Configuration for error handler */
export interface ErrorHandlerConfig {
  /** Maximum number of reports to keep in memory */
  maxReports: number;
  /** Whether to create detailed error files */
  createDetailedReports: boolean;
  /** Directory for error report files */
  reportDirectory: string;
  /** Recovery strategies to enable */
  enabledStrategies: string[];
}

/** Error boundary configuration */
export interface ErrorBoundaryConfig {
  /** Maximum retry attempts */
  maxRetries: number;
  /** Delay between retries (ms) */
  retryDelay: number;
  /** Operations timeout (ms) */
  operationTimeout: number;
  /** Fallback operations */
  fallbacks: Record<string, () => Promise<unknown>>;
}

/** Error transformer for converting non-AppError to AppError */
export interface IErrorTransformer {
  /** Transform unknown error to AppError */
  transform(error: unknown, context?: ErrorContext): AppError;
}

/** Logger interface for error handling */
export interface IErrorLogger {
  /** Log error occurrence */
  logError(error: AppError, context: ErrorContext): void;

  /** Log recovery attempt */
  logRecovery(error: AppError, attempt: RecoveryAttempt): void;

  /** Log error resolution */
  logResolution(error: AppError, resolvedAt: Date): void;
}
