/**
 * CLI Adapter for LLM Completion Provider
 * @module src/llm/cli-adapter
 *
 * Provides a fallback mechanism when API keys for LLM providers are not available.
 * Uses Claude Code CLI or Codex CLI for generating completions.
 */

import { ClaudeCodeCLI } from "../cli/claude-code.js";
import { CodexCLI } from "../cli/codex.js";
import type { CLITool, CLIToolType } from "../cli/types.js";
import type {
  LLMCompletionProvider,
  CompletionResult,
  ModelConfig,
  LLMProviderType,
} from "./types.js";

// =============================================================================
// Constants
// =============================================================================

/** Default timeout for CLI operations (5 minutes) */
const DEFAULT_CLI_TIMEOUT_MS = 300000;

/** Default project path for CLI execution */
const DEFAULT_PROJECT_PATH = process.cwd();

// =============================================================================
// CLI Adapter Configuration
// =============================================================================

/**
 * Configuration for CLI adapter
 */
export interface CLIAdapterConfig {
  /** CLI tool type to use: 'claude-code' or 'codex' */
  readonly cliType: CLIToolType;
  /** Project path for CLI execution */
  readonly projectPath?: string | undefined;
  /** Timeout in milliseconds */
  readonly timeout?: number | undefined;
}

// =============================================================================
// CLI Adapter Implementation
// =============================================================================

/**
 * CLI-based completion provider adapter
 *
 * Implements LLMCompletionProvider interface using CLI tools (Claude Code or Codex)
 * as the backend for text generation.
 *
 * @remarks
 * This adapter is useful as a fallback when API keys for cloud LLM providers
 * are not available. It leverages locally installed CLI tools for completions.
 *
 * @example
 * ```typescript
 * const adapter = new CLICompletionAdapter({ cliType: 'claude-code' });
 * const result = await adapter.complete("Explain this code...");
 * console.log(result.text);
 * ```
 */
export class CLICompletionAdapter implements LLMCompletionProvider {
  readonly name: LLMProviderType = "claude-code";

  private readonly cliTool: CLITool;
  private readonly projectPath: string;
  private readonly timeout: number;

  constructor(config: CLIAdapterConfig) {
    this.projectPath = config.projectPath ?? DEFAULT_PROJECT_PATH;
    this.timeout = config.timeout ?? DEFAULT_CLI_TIMEOUT_MS;

    // Create the appropriate CLI tool based on type
    switch (config.cliType) {
      case "claude-code":
        this.cliTool = new ClaudeCodeCLI();
        break;
      case "codex":
        this.cliTool = new CodexCLI();
        break;
      default: {
        const exhaustiveCheck: never = config.cliType;
        throw new Error(`Unknown CLI type: ${exhaustiveCheck}`);
      }
    }
  }

  /**
   * Generate text completion using CLI tool
   *
   * @param prompt - Input prompt for completion
   * @param _config - Model configuration (ignored for CLI, uses CLI defaults)
   * @returns Completion result with generated text
   */
  async complete(
    prompt: string,
    _config?: Partial<ModelConfig>
  ): Promise<CompletionResult> {
    const result = await this.cliTool.execute(
      this.projectPath,
      prompt,
      this.timeout
    );

    // Estimate token count (rough approximation: 4 chars per token)
    const estimatedTokenCount = Math.ceil(result.output.length / 4);

    return {
      text: result.output,
      tokenCount: estimatedTokenCount,
      model: `cli:${this.cliTool.name}`,
      finishReason: "stop",
    };
  }

  /**
   * Check if the CLI tool is available
   */
  async checkAvailability(): Promise<{ available: boolean; error?: string }> {
    const isAvailable = await this.cliTool.isAvailable();

    if (isAvailable) {
      return { available: true };
    }

    const errorMessage =
      this.cliTool.name === "claude-code"
        ? "Claude Code CLI not found. Install with: npm install -g @anthropic-ai/claude-code"
        : "Codex CLI not found or OPENAI_API_KEY not set";

    return {
      available: false,
      error: errorMessage,
    };
  }
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create a CLI completion adapter with auto-detection
 *
 * Tries to find an available CLI tool in order of preference:
 * 1. Claude Code CLI (preferred)
 * 2. Codex CLI (fallback)
 *
 * @param projectPath - Optional project path for CLI execution
 * @param timeout - Optional timeout in milliseconds
 * @returns CLI completion adapter or null if no CLI is available
 *
 * @example
 * ```typescript
 * const adapter = await createCLICompletionAdapter();
 * if (adapter) {
 *   const result = await adapter.complete("Hello!");
 * }
 * ```
 */
export async function createCLICompletionAdapter(
  projectPath?: string,
  timeout?: number
): Promise<CLICompletionAdapter | null> {
  // Try Claude Code CLI first (preferred)
  const claudeCLI = new ClaudeCodeCLI();
  if (await claudeCLI.isAvailable()) {
    return new CLICompletionAdapter({
      cliType: "claude-code",
      projectPath,
      timeout,
    });
  }

  // Try Codex CLI as fallback
  const codexCLI = new CodexCLI();
  if (await codexCLI.isAvailable()) {
    return new CLICompletionAdapter({
      cliType: "codex",
      projectPath,
      timeout,
    });
  }

  // No CLI available
  return null;
}

/**
 * Check if any CLI tool is available for completions
 *
 * @returns Object with availability status and available CLI type if any
 */
export async function checkCLIAvailability(): Promise<{
  available: boolean;
  cliType?: CLIToolType;
  error?: string;
}> {
  // Check Claude Code CLI
  const claudeCLI = new ClaudeCodeCLI();
  if (await claudeCLI.isAvailable()) {
    return { available: true, cliType: "claude-code" };
  }

  // Check Codex CLI
  const codexCLI = new CodexCLI();
  if (await codexCLI.isAvailable()) {
    return { available: true, cliType: "codex" };
  }

  return {
    available: false,
    error:
      "No CLI tool available. Install Claude Code CLI (npm install -g @anthropic-ai/claude-code) or set up Codex CLI with OPENAI_API_KEY.",
  };
}
