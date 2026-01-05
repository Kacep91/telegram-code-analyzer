import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "events";

// Mock child_process before importing the module
vi.mock("child_process", () => ({
  spawn: vi.fn(),
}));

// Mock path-validator to avoid file system operations
vi.mock("../../cli/path-validator.js", () => ({
  validateProjectPath: vi.fn().mockResolvedValue("/valid/project/path"),
}));

import { spawn } from "child_process";
import { CodexCLI } from "../../cli/codex.js";
import { validateProjectPath } from "../../cli/path-validator.js";

// Type for mocked spawn function
type SpawnMock = ReturnType<typeof vi.fn>;

/**
 * Minimal mock interface for ChildProcess used in tests
 * Only includes properties that are actually used by CodexCLI
 */
interface MockChildProcess extends EventEmitter {
  stdout: EventEmitter;
  stderr: EventEmitter;
  stdin: {
    write: ReturnType<typeof vi.fn>;
    end: ReturnType<typeof vi.fn>;
  };
  kill: ReturnType<typeof vi.fn>;
}

/**
 * Creates a mock ChildProcess with EventEmitter capabilities
 * Includes stdout, stderr as EventEmitters and stdin as writable stream mock
 */
function createMockChildProcess(): MockChildProcess {
  const mockProcess = new EventEmitter() as MockChildProcess;

  mockProcess.stdout = new EventEmitter();
  mockProcess.stderr = new EventEmitter();
  mockProcess.stdin = {
    write: vi.fn(),
    end: vi.fn(),
  };
  mockProcess.kill = vi.fn();

  return mockProcess;
}

describe("CodexCLI", () => {
  const mockSpawn = spawn as SpawnMock;

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset env before each test
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("isAvailable()", () => {
    it("should return true when API key is set and CLI is available", async () => {
      vi.stubEnv("OPENAI_API_KEY", "sk-test-key-123");

      const mockProcess = createMockChildProcess();
      mockSpawn.mockReturnValue(mockProcess);

      const cli = new CodexCLI();
      const resultPromise = cli.isAvailable();

      // Simulate successful CLI execution
      setImmediate(() => {
        mockProcess.emit("close", 0);
      });

      const result = await resultPromise;
      expect(result).toBe(true);
      expect(mockSpawn).toHaveBeenCalledWith(
        "npx",
        ["@openai/codex", "--help"],
        {
          stdio: ["ignore", "ignore", "ignore"],
        }
      );
    });

    it("should return false when API key is not set", async () => {
      vi.stubEnv("OPENAI_API_KEY", "");

      const cli = new CodexCLI();
      const result = await cli.isAvailable();

      expect(result).toBe(false);
      expect(mockSpawn).not.toHaveBeenCalled();
    });

    it("should return false when CLI spawn throws an error", async () => {
      vi.stubEnv("OPENAI_API_KEY", "sk-test-key-123");

      const mockProcess = createMockChildProcess();
      mockSpawn.mockReturnValue(mockProcess);

      const cli = new CodexCLI();
      const resultPromise = cli.isAvailable();

      // Simulate spawn error (e.g., CLI not found)
      setImmediate(() => {
        mockProcess.emit("error", new Error("spawn ENOENT"));
      });

      const result = await resultPromise;
      expect(result).toBe(false);
    });

    it("should return false when CLI exits with non-zero code", async () => {
      vi.stubEnv("OPENAI_API_KEY", "sk-test-key-123");

      const mockProcess = createMockChildProcess();
      mockSpawn.mockReturnValue(mockProcess);

      const cli = new CodexCLI();
      const resultPromise = cli.isAvailable();

      // Simulate CLI returning error exit code
      setImmediate(() => {
        mockProcess.emit("close", 1);
      });

      const result = await resultPromise;
      expect(result).toBe(false);
    });
  });

  describe("execute()", () => {
    const validProjectPath = "/valid/project/path";
    const validPrompt = "Analyze this code";

    it("should return successful result when CLI executes successfully", async () => {
      vi.stubEnv("OPENAI_API_KEY", "sk-test-key-123");

      const mockProcess = createMockChildProcess();
      mockSpawn.mockReturnValue(mockProcess);

      const cli = new CodexCLI();
      const resultPromise = cli.execute(validProjectPath, validPrompt);

      // Simulate stdout output and successful close
      setImmediate(() => {
        mockProcess.stdout.emit("data", Buffer.from("Analysis result: "));
        mockProcess.stdout.emit("data", Buffer.from("Code looks good"));
        mockProcess.emit("close", 0);
      });

      const result = await resultPromise;

      expect(result.output).toBe("Analysis result: Code looks good");
      expect(result.exitCode).toBe(0);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
      expect(mockProcess.stdin.write).toHaveBeenCalledWith(validPrompt);
      expect(mockProcess.stdin.end).toHaveBeenCalled();
      expect(validateProjectPath).toHaveBeenCalledWith(validProjectPath);
    });

    it("should throw error when timeout is exceeded", async () => {
      vi.stubEnv("OPENAI_API_KEY", "sk-test-key-123");

      const mockProcess = createMockChildProcess();
      mockSpawn.mockReturnValue(mockProcess);

      const cli = new CodexCLI();
      const shortTimeout = 50; // 50ms timeout for faster test

      const resultPromise = cli.execute(
        validProjectPath,
        validPrompt,
        shortTimeout
      );

      // Don't emit close - let it timeout

      await expect(resultPromise).rejects.toThrow(
        `Codex CLI timeout after ${shortTimeout}ms`
      );
      expect(mockProcess.kill).toHaveBeenCalledWith("SIGTERM");
    });

    it("should throw error when API key is not set", async () => {
      vi.stubEnv("OPENAI_API_KEY", "");

      const cli = new CodexCLI();

      await expect(cli.execute(validProjectPath, validPrompt)).rejects.toThrow(
        "OPENAI_API_KEY environment variable is required for Codex CLI"
      );

      expect(mockSpawn).not.toHaveBeenCalled();
    });

    it("should throw error when spawn fails", async () => {
      vi.stubEnv("OPENAI_API_KEY", "sk-test-key-123");

      const mockProcess = createMockChildProcess();
      mockSpawn.mockReturnValue(mockProcess);

      const cli = new CodexCLI();
      const resultPromise = cli.execute(validProjectPath, validPrompt);

      // Simulate spawn error
      setImmediate(() => {
        mockProcess.emit("error", new Error("spawn ENOENT"));
      });

      await expect(resultPromise).rejects.toThrow(
        "Failed to spawn Codex CLI: spawn ENOENT"
      );
    });

    it("should throw error when CLI exits with non-zero code", async () => {
      vi.stubEnv("OPENAI_API_KEY", "sk-test-key-123");

      const mockProcess = createMockChildProcess();
      mockSpawn.mockReturnValue(mockProcess);

      const cli = new CodexCLI();
      const resultPromise = cli.execute(validProjectPath, validPrompt);

      // Simulate stderr output and failed close
      setImmediate(() => {
        mockProcess.stderr.emit("data", Buffer.from("Error: Invalid prompt"));
        mockProcess.emit("close", 1);
      });

      await expect(resultPromise).rejects.toThrow(
        "Codex CLI failed with exit code 1. Stderr: Error: Invalid prompt"
      );
    });

    it("should use stderr as output when stdout is empty but exit code is 0", async () => {
      vi.stubEnv("OPENAI_API_KEY", "sk-test-key-123");

      const mockProcess = createMockChildProcess();
      mockSpawn.mockReturnValue(mockProcess);

      const cli = new CodexCLI();
      const resultPromise = cli.execute(validProjectPath, validPrompt);

      // Simulate only stderr output with successful exit
      setImmediate(() => {
        mockProcess.stderr.emit("data", Buffer.from("Warning: some info"));
        mockProcess.emit("close", 0);
      });

      const result = await resultPromise;
      expect(result.output).toBe("Warning: some info");
      expect(result.exitCode).toBe(0);
    });

    it("should pass correct arguments to spawn with custom mode", async () => {
      vi.stubEnv("OPENAI_API_KEY", "sk-test-key-123");

      const mockProcess = createMockChildProcess();
      mockSpawn.mockReturnValue(mockProcess);

      const cli = new CodexCLI("auto-edit");
      const resultPromise = cli.execute(validProjectPath, validPrompt);

      setImmediate(() => {
        mockProcess.emit("close", 0);
      });

      await resultPromise;

      expect(mockSpawn).toHaveBeenCalledWith(
        "npx",
        [
          "@openai/codex",
          "--mode",
          "auto-edit",
          "--cwd",
          validProjectPath,
          "-",
        ],
        expect.objectContaining({
          cwd: validProjectPath,
          stdio: ["pipe", "pipe", "pipe"],
        })
      );
    });
  });
});
