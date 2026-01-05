import { describe, it, expect } from "vitest";

describe("claude.ts re-exports", () => {
  it("should export ClaudeCodeCLI class", async () => {
    const { ClaudeCodeCLI } = await import("../claude.js");
    expect(ClaudeCodeCLI).toBeDefined();
    expect(typeof ClaudeCodeCLI).toBe("function");
  });

  it("should export executeClaudeAnalysis function", async () => {
    const { executeClaudeAnalysis } = await import("../claude.js");
    expect(executeClaudeAnalysis).toBeDefined();
    expect(typeof executeClaudeAnalysis).toBe("function");
  });

  it("should export checkClaudeAvailability function", async () => {
    const { checkClaudeAvailability } = await import("../claude.js");
    expect(checkClaudeAvailability).toBeDefined();
    expect(typeof checkClaudeAvailability).toBe("function");
  });
});
