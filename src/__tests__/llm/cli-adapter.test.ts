/**
 * Tests for CLI Adapter module
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// =============================================================================
// Mock setup - must be before imports that use mocked modules
// =============================================================================

// Use vi.hoisted to create mock classes that work with vitest
const { MockClaudeCodeCLI, MockCodexCLI } = vi.hoisted(() => {
  const mockClaudeCodeIsAvailable = vi.fn();
  const mockClaudeCodeExecute = vi.fn();
  const mockCodexIsAvailable = vi.fn();
  const mockCodexExecute = vi.fn();

  const MockClaudeCodeCLI = vi.fn().mockImplementation(function (this: {
    name: "claude-code";
    isAvailable: typeof mockClaudeCodeIsAvailable;
    execute: typeof mockClaudeCodeExecute;
  }) {
    this.name = "claude-code";
    this.isAvailable = mockClaudeCodeIsAvailable;
    this.execute = mockClaudeCodeExecute;
  });

  const MockCodexCLI = vi.fn().mockImplementation(function (this: {
    name: "codex";
    isAvailable: typeof mockCodexIsAvailable;
    execute: typeof mockCodexExecute;
  }) {
    this.name = "codex";
    this.isAvailable = mockCodexIsAvailable;
    this.execute = mockCodexExecute;
  });

  // Expose the mocks for external access
  (MockClaudeCodeCLI as unknown as { mockIsAvailable: typeof mockClaudeCodeIsAvailable }).mockIsAvailable = mockClaudeCodeIsAvailable;
  (MockClaudeCodeCLI as unknown as { mockExecute: typeof mockClaudeCodeExecute }).mockExecute = mockClaudeCodeExecute;
  (MockCodexCLI as unknown as { mockIsAvailable: typeof mockCodexIsAvailable }).mockIsAvailable = mockCodexIsAvailable;
  (MockCodexCLI as unknown as { mockExecute: typeof mockCodexExecute }).mockExecute = mockCodexExecute;

  return { MockClaudeCodeCLI, MockCodexCLI };
});

vi.mock("../../cli/claude-code.js", () => ({
  ClaudeCodeCLI: MockClaudeCodeCLI,
}));

vi.mock("../../cli/codex.js", () => ({
  CodexCLI: MockCodexCLI,
}));

// Import after mocks are set up
import {
  CLICompletionAdapter,
  createCLICompletionAdapter,
  checkCLIAvailability,
} from "../../llm/cli-adapter.js";

// Get references to mock functions from the hoisted mocks
const getMockClaudeCode = () => MockClaudeCodeCLI as unknown as {
  mockIsAvailable: ReturnType<typeof vi.fn>;
  mockExecute: ReturnType<typeof vi.fn>;
};
const getMockCodex = () => MockCodexCLI as unknown as {
  mockIsAvailable: ReturnType<typeof vi.fn>;
  mockExecute: ReturnType<typeof vi.fn>;
};

// =============================================================================
// Tests
// =============================================================================

describe("CLI Adapter Module", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset mock implementations
    getMockClaudeCode().mockIsAvailable.mockReset();
    getMockClaudeCode().mockExecute.mockReset();
    getMockCodex().mockIsAvailable.mockReset();
    getMockCodex().mockExecute.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ===========================================================================
  // CLICompletionAdapter
  // ===========================================================================

  describe("CLICompletionAdapter", () => {
    describe("constructor", () => {
      it("should create adapter with claude-code CLI type", () => {
        const adapter = new CLICompletionAdapter({ cliType: "claude-code" });
        expect(adapter.name).toBe("claude-code");
      });

      it("should create adapter with codex CLI type", () => {
        const adapter = new CLICompletionAdapter({ cliType: "codex" });
        expect(adapter.name).toBe("claude-code");
      });

      it("should use custom project path", () => {
        const adapter = new CLICompletionAdapter({
          cliType: "claude-code",
          projectPath: "/custom/path",
        });
        expect(adapter).toBeDefined();
      });

      it("should use custom timeout", () => {
        const adapter = new CLICompletionAdapter({
          cliType: "claude-code",
          timeout: 60000,
        });
        expect(adapter).toBeDefined();
      });
    });

    describe("complete()", () => {
      it("should execute CLI and return completion result", async () => {
        const expectedOutput = "Generated response from CLI";
        getMockClaudeCode().mockExecute.mockResolvedValue({
          output: expectedOutput,
          exitCode: 0,
          durationMs: 1000,
        });

        const adapter = new CLICompletionAdapter({ cliType: "claude-code" });
        const result = await adapter.complete("Test prompt");

        expect(result.text).toBe(expectedOutput);
        expect(result.model).toBe("cli:claude-code");
        expect(result.finishReason).toBe("stop");
        expect(result.tokenCount).toBeGreaterThan(0);
      });

      it("should estimate token count based on output length", async () => {
        // 40 characters / 4 = 10 tokens
        const output = "A".repeat(40);
        getMockClaudeCode().mockExecute.mockResolvedValue({
          output,
          exitCode: 0,
          durationMs: 500,
        });

        const adapter = new CLICompletionAdapter({ cliType: "claude-code" });
        const result = await adapter.complete("Test");

        expect(result.tokenCount).toBe(10);
      });

      it("should propagate CLI execution errors", async () => {
        getMockClaudeCode().mockExecute.mockRejectedValue(
          new Error("CLI execution failed")
        );

        const adapter = new CLICompletionAdapter({ cliType: "claude-code" });

        await expect(adapter.complete("Test")).rejects.toThrow(
          "CLI execution failed"
        );
      });

      it("should use Codex CLI when configured", async () => {
        const expectedOutput = "Codex response";
        getMockCodex().mockExecute.mockResolvedValue({
          output: expectedOutput,
          exitCode: 0,
          durationMs: 800,
        });

        const adapter = new CLICompletionAdapter({ cliType: "codex" });
        const result = await adapter.complete("Test prompt");

        expect(result.text).toBe(expectedOutput);
        expect(result.model).toBe("cli:codex");
      });
    });

    describe("checkAvailability()", () => {
      it("should return available: true when Claude Code CLI is available", async () => {
        getMockClaudeCode().mockIsAvailable.mockResolvedValue(true);

        const adapter = new CLICompletionAdapter({ cliType: "claude-code" });
        const result = await adapter.checkAvailability();

        expect(result.available).toBe(true);
        expect(result.error).toBeUndefined();
      });

      it("should return available: false with error when Claude Code CLI is not available", async () => {
        getMockClaudeCode().mockIsAvailable.mockResolvedValue(false);

        const adapter = new CLICompletionAdapter({ cliType: "claude-code" });
        const result = await adapter.checkAvailability();

        expect(result.available).toBe(false);
        expect(result.error).toContain("Claude Code CLI not found");
      });

      it("should return available: true when Codex CLI is available", async () => {
        getMockCodex().mockIsAvailable.mockResolvedValue(true);

        const adapter = new CLICompletionAdapter({ cliType: "codex" });
        const result = await adapter.checkAvailability();

        expect(result.available).toBe(true);
      });

      it("should return appropriate error message for Codex CLI", async () => {
        getMockCodex().mockIsAvailable.mockResolvedValue(false);

        const adapter = new CLICompletionAdapter({ cliType: "codex" });
        const result = await adapter.checkAvailability();

        expect(result.available).toBe(false);
        expect(result.error).toContain("Codex CLI not found");
      });
    });
  });

  // ===========================================================================
  // createCLICompletionAdapter
  // ===========================================================================

  describe("createCLICompletionAdapter()", () => {
    it("should return Claude Code adapter when available", async () => {
      getMockClaudeCode().mockIsAvailable.mockResolvedValue(true);

      const adapter = await createCLICompletionAdapter();

      expect(adapter).not.toBeNull();
      expect(adapter?.name).toBe("claude-code");
    });

    it("should return Codex adapter when Claude Code is not available", async () => {
      getMockClaudeCode().mockIsAvailable.mockResolvedValue(false);
      getMockCodex().mockIsAvailable.mockResolvedValue(true);

      const adapter = await createCLICompletionAdapter();

      expect(adapter).not.toBeNull();
    });

    it("should return null when no CLI is available", async () => {
      getMockClaudeCode().mockIsAvailable.mockResolvedValue(false);
      getMockCodex().mockIsAvailable.mockResolvedValue(false);

      const adapter = await createCLICompletionAdapter();

      expect(adapter).toBeNull();
    });

    it("should pass custom project path to adapter", async () => {
      getMockClaudeCode().mockIsAvailable.mockResolvedValue(true);

      const adapter = await createCLICompletionAdapter("/custom/project");

      expect(adapter).not.toBeNull();
    });

    it("should pass custom timeout to adapter", async () => {
      getMockClaudeCode().mockIsAvailable.mockResolvedValue(true);

      const adapter = await createCLICompletionAdapter(undefined, 120000);

      expect(adapter).not.toBeNull();
    });
  });

  // ===========================================================================
  // checkCLIAvailability
  // ===========================================================================

  describe("checkCLIAvailability()", () => {
    it("should return claude-code when it is available", async () => {
      getMockClaudeCode().mockIsAvailable.mockResolvedValue(true);

      const result = await checkCLIAvailability();

      expect(result.available).toBe(true);
      expect(result.cliType).toBe("claude-code");
      expect(result.error).toBeUndefined();
    });

    it("should return codex when only Codex is available", async () => {
      getMockClaudeCode().mockIsAvailable.mockResolvedValue(false);
      getMockCodex().mockIsAvailable.mockResolvedValue(true);

      const result = await checkCLIAvailability();

      expect(result.available).toBe(true);
      expect(result.cliType).toBe("codex");
    });

    it("should return not available when no CLI is present", async () => {
      getMockClaudeCode().mockIsAvailable.mockResolvedValue(false);
      getMockCodex().mockIsAvailable.mockResolvedValue(false);

      const result = await checkCLIAvailability();

      expect(result.available).toBe(false);
      expect(result.cliType).toBeUndefined();
      expect(result.error).toContain("No CLI tool available");
    });

    it("should prefer Claude Code CLI over Codex", async () => {
      getMockClaudeCode().mockIsAvailable.mockResolvedValue(true);
      getMockCodex().mockIsAvailable.mockResolvedValue(true);

      const result = await checkCLIAvailability();

      expect(result.cliType).toBe("claude-code");
    });
  });
});
