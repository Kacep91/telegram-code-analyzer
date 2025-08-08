export interface RateLimiterConfig {
  readonly maxRequests: number;
  readonly windowMs: number;
  readonly blockDurationMs?: number;
  readonly whitelist?: readonly number[];
  readonly cleanupIntervalMs: number;
}

export interface Config {
  readonly telegramToken: string;
  readonly authorizedUsers: number[];
  readonly projectPath: string;
  readonly claudeTimeout: number;
  readonly rateLimiter: RateLimiterConfig;
}

export interface ValidatedConfig extends Config {
  readonly telegramToken: string;
  readonly authorizedUsers: number[];
  readonly projectPath: string;
  readonly claudeTimeout: number;
}

export interface AnalysisResult {
  readonly summary: string;
  readonly filePath: string;
  readonly fileName: string;
  readonly fileSize: number;
  readonly duration?: number;
  readonly timestamp?: number;
}

export interface DetailedAnalysisResult extends AnalysisResult {
  readonly metadata: {
    readonly questionLength: number;
    readonly responseLength: number;
    readonly claudeVersion?: string;
    readonly processingSteps: readonly string[];
  };
}

export interface BotContext {
  readonly userId: number;
  readonly username?: string;
  readonly firstName?: string;
  readonly lastName?: string;
  readonly message: string;
  readonly messageId: number;
  readonly timestamp: number;
  readonly chatId: number;
}

export interface AnalysisBotContext extends BotContext {
  readonly sanitizedMessage: string;
  readonly messagePreview: string;
  readonly isRetry: boolean;
  readonly retryCount?: number;
}

export interface ClaudeAvailabilityResult {
  readonly available: boolean;
  readonly error?: string;
}

export interface ClaudeExecutionConfig {
  readonly projectPath: string;
  readonly timeout: number;
  readonly outputFormat: "text" | "json" | "markdown";
  readonly permissions: {
    readonly bypassPermissions: boolean;
    readonly dangerouslySkipPermissions: boolean;
  };
  readonly retries: {
    readonly maxAttempts: number;
    readonly backoffMs: number;
  };
}

export interface ClaudeProcessResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly duration: number;
  readonly killed: boolean;
  readonly command: string;
  readonly args: readonly string[];
}

export interface ClaudeCommand {
  readonly executable: string;
  readonly args: readonly string[];
  readonly options: {
    readonly cwd: string;
    readonly timeout: number;
    readonly stdio: readonly ["pipe", "pipe", "pipe"];
  };
}

export interface FileOperationResult {
  readonly success: boolean;
  readonly path: string;
  readonly size?: number;
  readonly mtime?: Date;
  readonly error?: string;
}

export interface PromptConfig {
  readonly templatePath: string;
  readonly outputPath: string;
  readonly maxLength: number;
  readonly encoding: "utf8" | "utf-8" | "ascii" | "base64" | "hex";
  readonly variables: Record<string, string>;
}

export interface AnalysisMetrics {
  readonly totalAnalyses: number;
  readonly successRate: number;
  readonly averageDuration: number;
  readonly errorCounts: Record<string, number>;
  readonly userStatistics: Record<
    number,
    {
      readonly requestCount: number;
      readonly lastRequest: number;
    }
  >;
}

export interface UserActivity {
  readonly userId: number;
  readonly username?: string;
  readonly requestCount: number;
  readonly lastActivity: number;
  readonly isBlocked: boolean;
  readonly dailyRequests: number;
  readonly totalRequestsAllTime: number;
}

export interface ValidationResult<T = unknown> {
  readonly success: boolean;
  readonly data?: T;
  readonly error?: string;
  readonly code?: string;
}

export interface HealthCheck {
  readonly status: "healthy" | "degraded" | "unhealthy";
  readonly timestamp: number;
  readonly services: {
    readonly claude: boolean;
    readonly telegram: boolean;
    readonly filesystem: boolean;
  };
  readonly metrics: {
    readonly uptime: number;
    readonly memoryUsage: NodeJS.MemoryUsage;
    readonly processCount: number;
  };
}

export interface ErrorContext {
  readonly component: string;
  readonly operation: string;
  readonly userId?: number;
  readonly requestId?: string;
  readonly metadata?: Record<string, unknown>;
  readonly timestamp: number;
}

export type TelegramUserId = number;
export type MessageId = number;
export type ChatId = number;
export type UnixTimestamp = number;
export type Milliseconds = number;
export type FilePath = string;
export type FileName = string;

export type NonEmptyString = string & { readonly __brand: "NonEmpty" };
export type PositiveNumber = number & { readonly __brand: "Positive" };
export type ReadonlyRecord<K extends keyof unknown, V> = {
  readonly [P in K]: V;
};

export type ConfigKey = keyof Config;
export type RequiredConfigKeys = {
  readonly [K in ConfigKey]-?: Config[K];
};

export type AnalysisFunction = (question: string) => Promise<AnalysisResult>;
export type ValidationFunction<T> = (value: unknown) => ValidationResult<T>;
export type ErrorHandler = (
  error: unknown,
  context?: ErrorContext
) => Promise<void>;
export type CleanupFunction = () => void | Promise<void>;

export type BotEventHandler = (ctx: BotContext) => Promise<void>;
export type MessageHandler = (
  message: string,
  userId: TelegramUserId
) => Promise<void>;
export type ErrorEventHandler = (error: Error, context: ErrorContext) => void;

export interface EnvironmentConfig {
  readonly NODE_ENV: "development" | "production" | "test";
  readonly LOG_LEVEL: "debug" | "info" | "warn" | "error";
  readonly TELEGRAM_BOT_TOKEN: string;
  readonly AUTHORIZED_USERS: string;
  readonly PROJECT_PATH: string;
  readonly CLAUDE_TIMEOUT: string;
  readonly CLAUDE_CLI_PATH?: string;
}

export const CONSTANTS = {
  MAX_MESSAGE_LENGTH: 2000,
  MIN_MESSAGE_LENGTH: 5,
  MAX_USERNAME_LENGTH: 100,
  MAX_FILE_SIZE: 10_485_760,
  DEFAULT_TIMEOUT: 300_000,
  MAX_TIMEOUT: 600_000,
  RATE_LIMIT_WINDOW: 60_000,
  MAX_REQUESTS_PER_MINUTE: 10,
} as const;

export type ConstantKey = keyof typeof CONSTANTS;
export type ConstantValue<K extends ConstantKey> = (typeof CONSTANTS)[K];
