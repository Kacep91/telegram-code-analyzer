/**
 * Claude Code CLI implementation
 */
import { spawn } from "child_process";
import { stat, readFile } from "fs/promises";
import { join, basename } from "path";
import type { CLITool, CLIToolResult } from "./types.js";
import type { AnalysisResult } from "../types.js";
import {
  ClaudeError,
  ClaudeErrorSubType,
  SystemError,
  SystemErrorSubType,
  FileSystemError,
  FileOperation,
} from "../errors/index.js";
import { saveAnalysis, getConfigValue } from "../utils.js";
import { validateProjectPath } from "./path-validator.js";

const DEFAULT_TIMEOUT_MS = 300000; // 5 minutes

/**
 * Claude Code CLI tool implementation
 */
export class ClaudeCodeCLI implements CLITool {
  readonly name = "claude-code" as const;

  /** Cached path to Claude CLI (reset on class instantiation) */
  private cachedClaudePath: string | null = null;

  /**
   * Check if a command exists and is executable
   */
  private async checkCommandExists(command: string): Promise<boolean> {
    return new Promise((resolve) => {
      const timeout = getConfigValue("CLAUDE_AVAILABILITY_CHECK_TIMEOUT");
      const proc = spawn(command, ["--version"], {
        stdio: ["ignore", "ignore", "ignore"],
      });

      let finished = false;

      const timer = setTimeout(() => {
        if (!finished) {
          finished = true;
          proc.kill("SIGTERM");
          resolve(false);
        }
      }, timeout);

      proc.on("close", (code) => {
        if (!finished) {
          finished = true;
          clearTimeout(timer);
          resolve(code === 0);
        }
      });

      proc.on("error", () => {
        if (!finished) {
          finished = true;
          clearTimeout(timer);
          resolve(false);
        }
      });
    });
  }

  /**
   * Find Claude CLI command with auto-detection
   * Searches in common locations if not explicitly configured
   */
  private async findClaudeCommand(): Promise<string> {
    // Return cached path if available
    if (this.cachedClaudePath) {
      return this.cachedClaudePath;
    }

    // 1. Check explicit path from environment
    const envPath = process.env["CLAUDE_CLI_PATH"];
    if (envPath?.trim()) {
      this.cachedClaudePath = envPath;
      return envPath;
    }

    // 2. Search in common locations
    const home = process.env["HOME"] ?? "";
    const candidates = [
      "claude", // System PATH
      join(home, ".local/bin/claude"),
      join(home, ".claude/local/claude"),
      "/usr/local/bin/claude",
      "/opt/homebrew/bin/claude",
    ];

    for (const candidate of candidates) {
      if (await this.checkCommandExists(candidate)) {
        this.cachedClaudePath = candidate;
        return candidate;
      }
    }

    throw new SystemError(
      "Claude CLI not found. Install: npm install -g @anthropic-ai/claude-code or set CLAUDE_CLI_PATH",
      SystemErrorSubType.CONFIG
    );
  }

  /**
   * Check if Claude Code CLI is available
   */
  async isAvailable(): Promise<boolean> {
    try {
      await this.findClaudeCommand();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Execute Claude Code CLI with the given prompt
   */
  async execute(
    projectPath: string,
    prompt: string,
    timeout: number = DEFAULT_TIMEOUT_MS
  ): Promise<CLIToolResult> {
    // Validate path is within allowed base directory (security check)
    await validateProjectPath(projectPath);

    const startTime = Date.now();
    const command = await this.findClaudeCommand();

    return new Promise((resolve, reject) => {
      const childProcess = spawn(
        command,
        [
          "--print",
          "-p",
          "-",
          "--output-format",
          "text",
          "--dangerously-skip-permissions",
          "--permission-mode",
          "bypassPermissions",
        ],
        {
          cwd: projectPath,
          stdio: ["pipe", "pipe", "pipe"],
        }
      );

      let stdout = "";
      let stderr = "";
      let finished = false;

      const timeoutId = setTimeout(() => {
        if (!finished) {
          finished = true;
          childProcess.kill("SIGTERM");
          reject(new Error(`Claude Code CLI timeout after ${timeout}ms`));
        }
      }, timeout);

      childProcess.stdout?.on("data", (data: Buffer) => {
        stdout += data.toString();
      });

      childProcess.stderr?.on("data", (data: Buffer) => {
        stderr += data.toString();
      });

      childProcess.on("close", (code) => {
        if (!finished) {
          finished = true;
          clearTimeout(timeoutId);

          const durationMs = Date.now() - startTime;
          const exitCode = code ?? 1;

          if (exitCode === 0 && stdout.trim()) {
            resolve({
              output: stdout,
              exitCode,
              durationMs,
            });
          } else {
            reject(
              new Error(
                `Claude Code CLI failed with exit code ${exitCode}. Stderr: ${stderr}`
              )
            );
          }
        }
      });

      childProcess.on("error", (error) => {
        if (!finished) {
          finished = true;
          clearTimeout(timeoutId);
          reject(
            new Error(`Failed to spawn Claude Code CLI: ${error.message}`)
          );
        }
      });

      if (childProcess.stdin) {
        try {
          childProcess.stdin.write(prompt);
          childProcess.stdin.end();
        } catch (error) {
          if (!finished) {
            finished = true;
            clearTimeout(timeoutId);
            const message =
              error instanceof Error
                ? error.message
                : "Unknown stdin write error";
            reject(
              new Error(`Failed to write to Claude Code CLI stdin: ${message}`)
            );
          }
        }
      }
    });
  }
}

/**
 * Execute Claude analysis with the existing API signature for backward compatibility
 */
export async function executeClaudeAnalysis(
  question: string
): Promise<AnalysisResult> {
  const startTime = Date.now();
  const projectPath = process.env["PROJECT_PATH"];
  const timeout = parseInt(process.env["CLAUDE_TIMEOUT"] || "300000", 10);

  if (!projectPath) {
    throw new SystemError(
      "PROJECT_PATH not specified in environment variables",
      SystemErrorSubType.CONFIG
    );
  }

  console.log(`Starting Claude analysis: "${question.substring(0, 100)}..."`);

  try {
    const promptPath = join(projectPath, "prompts", "code-analyzer.md");
    let promptTemplate: string;

    try {
      promptTemplate = await readFile(promptPath, "utf-8");
    } catch (error) {
      throw new FileSystemError(
        "Failed to load prompt file",
        FileOperation.READ,
        promptPath,
        undefined,
        error instanceof Error ? error : undefined
      );
    }

    const fullPrompt = `${promptTemplate}\n\nUSER QUESTION:\n\n${question}`;

    const cli = new ClaudeCodeCLI();
    const result = await cli.execute(projectPath, fullPrompt, timeout);

    const duration = Date.now() - startTime;
    console.log(`Analysis completed in ${duration}ms`);

    const filePath = await saveAnalysis(question, result.output);
    const fileStats = await stat(filePath);

    const summary =
      result.output.length > 300
        ? result.output.substring(0, 300).trim() + "..."
        : result.output;

    return {
      summary,
      filePath,
      fileName: basename(filePath),
      fileSize: fileStats.size,
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`Analysis failed after ${duration}ms:`, error);

    if (error instanceof ClaudeError) {
      throw error;
    }

    const message = error instanceof Error ? error.message : "Unknown error";

    const errorSubType = determineClaudeErrorSubType(message);

    throw new ClaudeError(
      `Claude analysis failed: ${message}`,
      errorSubType,
      { duration },
      error instanceof Error ? error : undefined
    );
  }
}

/**
 * Check Claude Code CLI availability for backward compatibility
 */
export async function checkClaudeAvailability(): Promise<{
  available: boolean;
  error?: string;
}> {
  const cli = new ClaudeCodeCLI();
  const available = await cli.isAvailable();

  if (available) {
    return { available: true };
  }

  return {
    available: false,
    error:
      "Claude CLI not found. Install with: npm install -g @anthropic-ai/claude-code",
  };
}

/**
 * Determine Claude error subtype from error message
 */
function determineClaudeErrorSubType(message: string): ClaudeErrorSubType {
  const messageLower = message.toLowerCase();

  if (messageLower.includes("timeout")) {
    return ClaudeErrorSubType.TIMEOUT;
  }

  if (
    messageLower.includes("not found") ||
    messageLower.includes("enoent") ||
    messageLower.includes("spawn")
  ) {
    return ClaudeErrorSubType.UNAVAILABLE;
  }

  if (
    messageLower.includes("project") &&
    (messageLower.includes("not found") ||
      messageLower.includes("does not exist"))
  ) {
    return ClaudeErrorSubType.PROJECT_NOT_FOUND;
  }

  return ClaudeErrorSubType.EXECUTION;
}
