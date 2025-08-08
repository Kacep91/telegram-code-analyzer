/**
 * Claude Code CLI integration module
 */
import { spawn } from "child_process";
import { readFile, stat } from "fs/promises";
import { join } from "path";
import type { AnalysisResult } from "./types.js";
import { saveAnalysis } from "./utils.js";

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
    throw new Error("PROJECT_PATH not specified in environment variables");
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
    throw new Error(`Claude analysis failed: ${getErrorMessage(error)}`);
  }
}

async function loadPrompt(projectPath: string): Promise<string> {
  const promptPath = join(projectPath, "prompts", "code-analyzer.md");

  try {
    return await readFile(promptPath, "utf-8");
  } catch (error) {
    throw new Error(`Failed to load prompt file: ${promptPath}`);
  }
}

async function runClaudeCommand(
  projectPath: string,
  promptContent: string,
  timeout: number
): Promise<string> {
  return new Promise((resolve, reject) => {
    const process = spawn(
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
        timeout: timeout,
      }
    );

    let stdout = "";
    let stderr = "";
    let finished = false;

    const timeoutId = setTimeout(() => {
      if (!finished) {
        finished = true;
        process.kill("SIGTERM");
        reject(new Error(`Process timeout after ${timeout}ms`));
      }
    }, timeout);

    process.stdout?.on("data", (data) => {
      stdout += data.toString();
    });

    process.stderr?.on("data", (data) => {
      stderr += data.toString();
    });

    process.on("close", (code) => {
      if (!finished) {
        finished = true;
        clearTimeout(timeoutId);

        if (code === 0 && stdout.trim()) {
          resolve(stdout);
        } else {
          reject(
            new Error(`Process exited with code ${code}. Stderr: ${stderr}`)
          );
        }
      }
    });

    process.on("error", (error) => {
      if (!finished) {
        finished = true;
        clearTimeout(timeoutId);
        reject(error);
      }
    });

    if (process.stdin) {
      try {
        process.stdin.write(promptContent);
        process.stdin.end();
      } catch (error) {
        if (!finished) {
          finished = true;
          clearTimeout(timeoutId);
          reject(error);
        }
      }
    }
  });
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
    fileName: filePath.split("/").pop() || "analysis.md",
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
