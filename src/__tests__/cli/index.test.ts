import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { CLITool } from "../../cli/types.js";

// Mock ClaudeCodeCLI
vi.mock("../../cli/claude-code.js", () => {
  const mockClaudeCodeCLI = vi.fn();
  return {
    ClaudeCodeCLI: mockClaudeCodeCLI,
  };
});

// Mock CodexCLI
vi.mock("../../cli/codex.js", () => {
  const mockCodexCLI = vi.fn();
  return {
    CodexCLI: mockCodexCLI,
  };
});

// Import after mocks are set up
import {
  createCLITool,
  getAvailableCLITools,
  getCLIToolIfAvailable,
} from "../../cli/index.js";
import { ClaudeCodeCLI } from "../../cli/claude-code.js";
import { CodexCLI } from "../../cli/codex.js";

// Type for mocked constructor
type MockedClass<T> = ReturnType<typeof vi.fn> & {
  mockImplementation: (fn: () => T) => void;
};

describe("CLI Index Module", () => {
  const mockClaudeCodeInstance: CLITool = {
    name: "claude-code",
    isAvailable: vi.fn(),
    execute: vi.fn(),
  };

  const mockCodexInstance: CLITool = {
    name: "codex",
    isAvailable: vi.fn(),
    execute: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Configure mocks to return instances
    (ClaudeCodeCLI as MockedClass<CLITool>).mockImplementation(
      () => mockClaudeCodeInstance
    );
    (CodexCLI as MockedClass<CLITool>).mockImplementation(
      () => mockCodexInstance
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("createCLITool", () => {
    it("should return ClaudeCodeCLI instance for type 'claude-code'", () => {
      const tool = createCLITool("claude-code");

      expect(ClaudeCodeCLI).toHaveBeenCalledTimes(1);
      expect(tool).toBe(mockClaudeCodeInstance);
      expect(tool.name).toBe("claude-code");
    });

    it("should return CodexCLI instance for type 'codex'", () => {
      const tool = createCLITool("codex");

      expect(CodexCLI).toHaveBeenCalledTimes(1);
      expect(tool).toBe(mockCodexInstance);
      expect(tool.name).toBe("codex");
    });

    it("should pass codexMode config to CodexCLI constructor", () => {
      createCLITool("codex", { codexMode: "auto-edit" });

      expect(CodexCLI).toHaveBeenCalledWith("auto-edit");
    });

    it("should throw Error for unknown CLI tool type", () => {
      // TypeScript prevents this at compile time, but we test runtime behavior
      // by casting to bypass type checking
      const unknownType = "unknown-tool" as "claude-code";

      expect(() => createCLITool(unknownType)).toThrow(
        "Unknown CLI tool type: unknown-tool"
      );
    });
  });

  describe("getAvailableCLITools", () => {
    it("should return both tools when all are available", async () => {
      vi.mocked(mockClaudeCodeInstance.isAvailable).mockResolvedValue(true);
      vi.mocked(mockCodexInstance.isAvailable).mockResolvedValue(true);

      const tools = await getAvailableCLITools();

      expect(tools).toHaveLength(2);
      expect(tools.map((t) => t.name)).toContain("claude-code");
      expect(tools.map((t) => t.name)).toContain("codex");
    });

    it("should return empty array when no tools are available", async () => {
      vi.mocked(mockClaudeCodeInstance.isAvailable).mockResolvedValue(false);
      vi.mocked(mockCodexInstance.isAvailable).mockResolvedValue(false);

      const tools = await getAvailableCLITools();

      expect(tools).toHaveLength(0);
      expect(tools).toEqual([]);
    });

    it("should return only available tools when partially available", async () => {
      vi.mocked(mockClaudeCodeInstance.isAvailable).mockResolvedValue(true);
      vi.mocked(mockCodexInstance.isAvailable).mockResolvedValue(false);

      const tools = await getAvailableCLITools();

      expect(tools).toHaveLength(1);
      expect(tools[0]?.name).toBe("claude-code");
    });
  });

  describe("getCLIToolIfAvailable", () => {
    it("should return tool when it is available", async () => {
      vi.mocked(mockClaudeCodeInstance.isAvailable).mockResolvedValue(true);

      const tool = await getCLIToolIfAvailable("claude-code");

      expect(tool).not.toBeNull();
      expect(tool?.name).toBe("claude-code");
    });

    it("should return null when tool is not available", async () => {
      vi.mocked(mockCodexInstance.isAvailable).mockResolvedValue(false);

      const tool = await getCLIToolIfAvailable("codex");

      expect(tool).toBeNull();
    });

    it("should pass config to createCLITool when provided", async () => {
      vi.mocked(mockCodexInstance.isAvailable).mockResolvedValue(true);

      await getCLIToolIfAvailable("codex", { codexMode: "full-auto" });

      expect(CodexCLI).toHaveBeenCalledWith("full-auto");
    });
  });
});
