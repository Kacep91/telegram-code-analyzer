import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Use vi.hoisted() to create shared mock functions that are available during vi.mock() hoisting
const {
  claudeCodeIsAvailable,
  claudeCodeExecute,
  codexIsAvailable,
  codexExecute,
} = vi.hoisted(() => ({
  claudeCodeIsAvailable: vi.fn<() => Promise<boolean>>(),
  claudeCodeExecute: vi.fn(),
  codexIsAvailable: vi.fn<() => Promise<boolean>>(),
  codexExecute: vi.fn(),
}));

// Mock ClaudeCodeCLI
vi.mock("../../cli/claude-code.js", () => {
  return {
    ClaudeCodeCLI: vi.fn().mockImplementation(function (this: unknown) {
      return {
        name: "claude-code",
        isAvailable: claudeCodeIsAvailable,
        execute: claudeCodeExecute,
      };
    }),
  };
});

// Mock CodexCLI
vi.mock("../../cli/codex.js", () => {
  return {
    CodexCLI: vi.fn().mockImplementation(function (this: unknown) {
      return {
        name: "codex",
        isAvailable: codexIsAvailable,
        execute: codexExecute,
      };
    }),
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

describe("CLI Index Module", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("createCLITool", () => {
    it("should return ClaudeCodeCLI instance for type 'claude-code'", () => {
      const tool = createCLITool("claude-code");

      expect(ClaudeCodeCLI).toHaveBeenCalledTimes(1);
      expect(tool.name).toBe("claude-code");
    });

    it("should return CodexCLI instance for type 'codex'", () => {
      const tool = createCLITool("codex");

      expect(CodexCLI).toHaveBeenCalledTimes(1);
      expect(tool.name).toBe("codex");
    });

    it("should pass codexMode config to CodexCLI constructor", () => {
      createCLITool("codex", { codexMode: "auto-edit" });

      expect(CodexCLI).toHaveBeenCalledWith("auto-edit");
    });

    it("should throw Error for unknown CLI tool type", () => {
      // @ts-expect-error testing invalid runtime input
      expect(() => createCLITool("unknown-tool")).toThrow(
        "Unknown CLI tool type: unknown-tool"
      );
    });
  });

  describe("getAvailableCLITools", () => {
    it("should return both tools when all are available", async () => {
      claudeCodeIsAvailable.mockResolvedValue(true);
      codexIsAvailable.mockResolvedValue(true);

      const tools = await getAvailableCLITools();

      expect(tools).toHaveLength(2);
      expect(tools.map((t) => t.name)).toContain("claude-code");
      expect(tools.map((t) => t.name)).toContain("codex");
    });

    it("should return empty array when no tools are available", async () => {
      claudeCodeIsAvailable.mockResolvedValue(false);
      codexIsAvailable.mockResolvedValue(false);

      const tools = await getAvailableCLITools();

      expect(tools).toHaveLength(0);
      expect(tools).toEqual([]);
    });

    it("should return only available tools when partially available", async () => {
      claudeCodeIsAvailable.mockResolvedValue(true);
      codexIsAvailable.mockResolvedValue(false);

      const tools = await getAvailableCLITools();

      expect(tools).toHaveLength(1);
      expect(tools[0]?.name).toBe("claude-code");
    });
  });

  describe("getCLIToolIfAvailable", () => {
    it("should return tool when it is available", async () => {
      claudeCodeIsAvailable.mockResolvedValue(true);

      const tool = await getCLIToolIfAvailable("claude-code");

      expect(tool).not.toBeNull();
      expect(tool?.name).toBe("claude-code");
    });

    it("should return null when tool is not available", async () => {
      codexIsAvailable.mockResolvedValue(false);

      const tool = await getCLIToolIfAvailable("codex");

      expect(tool).toBeNull();
    });

    it("should pass config to createCLITool when provided", async () => {
      codexIsAvailable.mockResolvedValue(true);

      await getCLIToolIfAvailable("codex", { codexMode: "full-auto" });

      expect(CodexCLI).toHaveBeenCalledWith("full-auto");
    });
  });
});
