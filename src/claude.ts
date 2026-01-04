/**
 * Claude Code CLI integration module
 */
import { spawn } from "child_process";
import { readFile, stat } from "fs/promises";
import { join, basename } from "path";
import type { AnalysisResult } from "./types.js";
import { saveAnalysis } from "./utils.js";
import {
  ClaudeError,
  ClaudeErrorSubType,
  SystemError,
  SystemErrorSubType,
  FileSystemError,
  FileOperation,
} from "./errors/index.js";

type SimpleError = {
  message?: string;
  code?: string;
  stderr?: string;
};

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
    const promptTemplate = await loadPrompt(projectPath);
    const fullPrompt = `${promptTemplate}\n\nUSER QUESTION:\n\n${question}`;

    const result = await runClaudeCommand(projectPath, fullPrompt, timeout);

    return await saveResult(question, result, startTime);
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`Analysis failed after ${duration}ms:`, error);

    if (error instanceof ClaudeError) {
      throw error;
    }

    const message = `Claude analysis failed: ${getErrorMessage(error)}`;
    throw new ClaudeError(
      message,
      ClaudeErrorSubType.EXECUTION,
      { duration },
      error instanceof Error ? error : undefined
    );
  }
}

async function loadPrompt(projectPath: string): Promise<string> {
  const promptPath = join(projectPath, "prompts", "code-analyzer.md");

  try {
    return await readFile(promptPath, "utf-8");
  } catch (error) {
    throw new FileSystemError(
      "Failed to load prompt file",
      FileOperation.READ,
      promptPath,
      undefined,
      error instanceof Error ? error : undefined
    );
  }
}

async function runClaudeCommand(
  projectPath: string,
  promptContent: string,
  timeout: number
): Promise<string> {
  return new Promise((resolve, reject) => {
    const childProcess = spawn(
      "npx",
      [
        "@anthropic-ai/claude-code",
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
        reject(
          new ClaudeError(
            `Process timeout after ${timeout}ms`,
            ClaudeErrorSubType.TIMEOUT,
            { timeout }
          )
        );
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

        if (code === 0 && stdout.trim()) {
          resolve(stdout);
        } else {
          const errorSubType = determineClaudeErrorSubType(stderr, code);
          reject(
            new ClaudeError(
              `Process exited with code ${code}. Stderr: ${stderr}`,
              errorSubType,
              { exitCode: code, stderr }
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
          new ClaudeError(
            `Failed to spawn Claude process: ${error.message}`,
            ClaudeErrorSubType.UNAVAILABLE,
            undefined,
            error
          )
        );
      }
    });

    if (childProcess.stdin) {
      try {
        childProcess.stdin.write(promptContent);
        childProcess.stdin.end();
      } catch (error) {
        if (!finished) {
          finished = true;
          clearTimeout(timeoutId);
          reject(
            new ClaudeError(
              "Failed to write to Claude process stdin",
              ClaudeErrorSubType.EXECUTION,
              undefined,
              error instanceof Error ? error : undefined
            )
          );
        }
      }
    }
  });
}

function determineClaudeErrorSubType(
  stderr: string,
  exitCode: number | null
): ClaudeErrorSubType {
  const stderrLower = stderr.toLowerCase();

  if (stderrLower.includes("not found") || stderrLower.includes("enoent")) {
    return ClaudeErrorSubType.UNAVAILABLE;
  }

  if (
    stderrLower.includes("project") &&
    (stderrLower.includes("not found") || stderrLower.includes("does not exist"))
  ) {
    return ClaudeErrorSubType.PROJECT_NOT_FOUND;
  }

  if (exitCode === 127) {
    return ClaudeErrorSubType.UNAVAILABLE;
  }

  return ClaudeErrorSubType.EXECUTION;
}

async function saveResult(
  question: string,
  content: string,
  startTime: number
): Promise<AnalysisResult> {
  const duration = Date.now() - startTime;
  console.log(`Analysis completed in ${duration}ms`);

  const filePath = await saveAnalysis(question, content);
  const fileStats = await stat(filePath);

  const summary =
    content.length > 300 ? content.substring(0, 300).trim() + "..." : content;

  return {
    summary,
    filePath,
    fileName: basename(filePath),
    fileSize: fileStats.size,
  };
}

export async function checkClaudeAvailability(): Promise<{
  available: boolean;
  error?: string;
}> {
  return new Promise((resolve) => {
    const process = spawn("npx", ["@anthropic-ai/claude-code", "--version"], {
      stdio: ["ignore", "ignore", "ignore"],
      timeout: 5000,
    });

    let finished = false;

    const timeoutId = setTimeout(() => {
      if (!finished) {
        finished = true;
        process.kill("SIGTERM");
        resolve({
          available: false,
          error: "Claude CLI check timeout",
        });
      }
    }, 5000);

    process.on("close", (code) => {
      if (!finished) {
        finished = true;
        clearTimeout(timeoutId);
        if (code === 0) {
          resolve({ available: true });
        } else {
          resolve({
            available: false,
            error: `Claude CLI not available (exit code: ${code})`,
          });
        }
      }
    });

    process.on("error", () => {
      if (!finished) {
        finished = true;
        clearTimeout(timeoutId);
        resolve({
          available: false,
          error:
            "Claude CLI not found. Install with: npm install -g @anthropic-ai/claude-code",
        });
      }
    });
  });
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  const simpleError = error as SimpleError;
  if (simpleError?.message) {
    return simpleError.message;
  }

  return "Unknown error";
}
