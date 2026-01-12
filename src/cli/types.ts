import { z } from "zod";

// CLI tool types
export const CLIToolTypeSchema = z.enum(["claude-code", "codex"]);
export type CLIToolType = z.infer<typeof CLIToolTypeSchema>;

/** Result of CLI tool execution */
export interface CLIToolResult {
  readonly output: string;
  readonly exitCode: number;
  /** Duration in milliseconds */
  readonly durationMs: number;
}

/** Options for CLI tool execution */
export interface CLIExecuteOptions {
  readonly timeout?: number | undefined;
  readonly model?: string | undefined;
}

// CLI tool interface
export interface CLITool {
  readonly name: CLIToolType;

  isAvailable(): Promise<boolean>;

  execute(
    projectPath: string,
    prompt: string,
    options?: CLIExecuteOptions
  ): Promise<CLIToolResult>;
}

// Codex specific modes
export const CodexModeSchema = z.enum(["suggest", "auto-edit", "full-auto"]);
export type CodexMode = z.infer<typeof CodexModeSchema>;
