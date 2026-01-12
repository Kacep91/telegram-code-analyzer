/**
 * OpenAI Codex CLI implementation
 */
import { spawn } from "child_process";
import type { CLITool, CLIToolResult, CodexMode, CLIExecuteOptions } from "./types.js";
import { validateProjectPath } from "./path-validator.js";

const DEFAULT_TIMEOUT_MS = 300000; // 5 minutes
const AVAILABILITY_CHECK_TIMEOUT_MS = 5000;
const DEFAULT_MODE: CodexMode = "suggest";
const MAX_PROMPT_LENGTH = 100000;

/**
 * OpenAI Codex CLI tool implementation
 *
 * Codex CLI modes:
 * - suggest: non-interactive suggestions (default)
 * - auto-edit: automatically apply changes
 * - full-auto: fully autonomous mode
 *
 * Requires OPENAI_API_KEY environment variable to be set
 */
export class CodexCLI implements CLITool {
  readonly name = "codex" as const;
  private readonly mode: CodexMode;

  constructor(mode: CodexMode = DEFAULT_MODE) {
    this.mode = mode;
  }

  /**
   * Check if Codex CLI is available
   * Verifies both CLI availability and API key presence
   */
  async isAvailable(): Promise<boolean> {
    // Check if OPENAI_API_KEY is set
    if (!process.env["OPENAI_API_KEY"]) {
      return false;
    }

    return new Promise((resolve) => {
      const childProcess = spawn("npx", ["@openai/codex", "--help"], {
        stdio: ["ignore", "ignore", "ignore"],
      });

      let finished = false;

      const timeoutId = setTimeout(() => {
        if (!finished) {
          finished = true;
          childProcess.kill("SIGTERM");
          resolve(false);
        }
      }, AVAILABILITY_CHECK_TIMEOUT_MS);

      childProcess.on("close", (code) => {
        if (!finished) {
          finished = true;
          clearTimeout(timeoutId);
          resolve(code === 0);
        }
      });

      childProcess.on("error", () => {
        if (!finished) {
          finished = true;
          clearTimeout(timeoutId);
          resolve(false);
        }
      });
    });
  }

  /**
   * Execute Codex CLI with the given prompt
   * Security: Prompt is passed via stdin to prevent command injection
   */
  async execute(
    projectPath: string,
    prompt: string,
    options?: CLIExecuteOptions
  ): Promise<CLIToolResult> {
    const timeout = options?.timeout ?? DEFAULT_TIMEOUT_MS;
    // Note: model option is ignored for Codex CLI

    // Validate path is within allowed base directory (security check)
    await validateProjectPath(projectPath);
    this.validateApiKey();
    this.validatePrompt(prompt);

    const startTime = Date.now();

    return new Promise((resolve, reject) => {
      // Security: Use stdin for prompt instead of CLI argument
      // The "-" argument tells Codex to read from stdin
      const childProcess = spawn(
        "npx",
        ["@openai/codex", "--mode", this.mode, "--cwd", projectPath, "-"],
        {
          cwd: projectPath,
          stdio: ["pipe", "pipe", "pipe"],
          env: {
            ...process.env,
          },
        }
      );

      let stdout = "";
      let stderr = "";
      let finished = false;

      const timeoutId = setTimeout(() => {
        if (!finished) {
          finished = true;
          childProcess.kill("SIGTERM");
          reject(new Error(`Codex CLI timeout after ${timeout}ms`));
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

          if (exitCode === 0) {
            resolve({
              output: stdout || stderr,
              exitCode,
              durationMs,
            });
          } else {
            reject(
              new Error(
                `Codex CLI failed with exit code ${exitCode}. Stderr: ${stderr}`
              )
            );
          }
        }
      });

      childProcess.on("error", (error) => {
        if (!finished) {
          finished = true;
          clearTimeout(timeoutId);
          reject(new Error(`Failed to spawn Codex CLI: ${error.message}`));
        }
      });

      // Write prompt to stdin (security: avoids command injection)
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
            reject(new Error(`Failed to write to Codex CLI stdin: ${message}`));
          }
        }
      }
    });
  }

  /**
   * Validate prompt length for sanity check
   * Even with stdin, we limit prompt size to prevent resource exhaustion
   */
  private validatePrompt(prompt: string): void {
    if (prompt.length > MAX_PROMPT_LENGTH) {
      throw new Error(
        `Prompt exceeds maximum length of ${MAX_PROMPT_LENGTH} characters`
      );
    }
  }

  /**
   * Validate that OPENAI_API_KEY is set
   */
  private validateApiKey(): void {
    if (!process.env["OPENAI_API_KEY"]) {
      throw new Error(
        "OPENAI_API_KEY environment variable is required for Codex CLI"
      );
    }
  }
}
