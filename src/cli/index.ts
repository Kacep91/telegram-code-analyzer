/**
 * CLI tools factory and registry
 */
import { ClaudeCodeCLI } from "./claude-code.js";
import { CodexCLI } from "./codex.js";
import type { CLITool, CLIToolType, CodexMode } from "./types.js";

// Re-export classes
export { ClaudeCodeCLI } from "./claude-code.js";
export { CodexCLI } from "./codex.js";

// Re-export types
export * from "./types.js";

// Re-export path validation utilities
export {
  validatePathWithinBase,
  getAllowedBasePath,
  validateProjectPath,
} from "./path-validator.js";

// Re-export backward compatibility functions
export {
  executeClaudeAnalysis,
  checkClaudeAvailability,
} from "./claude-code.js";

/**
 * Configuration for creating CLI tools
 */
export interface CLIToolConfig {
  readonly codexMode?: CodexMode;
}

/**
 * Create a CLI tool by type
 *
 * @param type - The type of CLI tool to create
 * @param config - Optional configuration for the tool
 * @returns The created CLI tool instance
 * @throws Error if the tool type is unknown
 */
export function createCLITool(
  type: CLIToolType,
  config?: CLIToolConfig
): CLITool {
  switch (type) {
    case "claude-code":
      return new ClaudeCodeCLI();
    case "codex":
      return new CodexCLI(config?.codexMode);
    default: {
      const exhaustiveCheck: never = type;
      throw new Error(`Unknown CLI tool type: ${exhaustiveCheck}`);
    }
  }
}

/**
 * Get all available CLI tools
 *
 * @returns Array of available CLI tools
 */
export async function getAvailableCLITools(): Promise<readonly CLITool[]> {
  const tools: CLITool[] = [new ClaudeCodeCLI(), new CodexCLI()];
  const available: CLITool[] = [];

  for (const tool of tools) {
    if (await tool.isAvailable()) {
      available.push(tool);
    }
  }

  return available;
}

/**
 * Get a specific CLI tool if available
 *
 * @param type - The type of CLI tool to get
 * @param config - Optional configuration for the tool
 * @returns The CLI tool if available, null otherwise
 */
export async function getCLIToolIfAvailable(
  type: CLIToolType,
  config?: CLIToolConfig
): Promise<CLITool | null> {
  const tool = createCLITool(type, config);
  const isAvailable = await tool.isAvailable();
  return isAvailable ? tool : null;
}
