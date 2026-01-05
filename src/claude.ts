/**
 * Claude Code CLI integration module
 *
 * This file re-exports from the new CLI module structure for backward compatibility.
 */

// Re-export for backward compatibility
export { ClaudeCodeCLI } from "./cli/index.js";
export {
  executeClaudeAnalysis,
  checkClaudeAvailability,
} from "./cli/claude-code.js";
