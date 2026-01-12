/**
 * Tests for Claude Code CLI module
 */
import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type MockInstance,
} from "vitest";
import { EventEmitter } from "events";
import type { ChildProcess } from "child_process";

/** Timeout value used in tests for consistent timing */
const TEST_TIMEOUT = 1000;

// Mock modules before imports
vi.mock("child_process", () => ({
  spawn: vi.fn(),
}));

vi.mock("fs/promises", () => ({
  readFile: vi.fn(),
  stat: vi.fn(),
}));

vi.mock("../../cli/path-validator.js", () => ({
  validateProjectPath: vi.fn(),
}));

vi.mock("../../utils.js", () => ({
  saveAnalysis: vi.fn(),
  getConfigValue: vi.fn((key: string) => {
    const defaults: Record<string, number> = {
      CLAUDE_AVAILABILITY_CHECK_TIMEOUT: 5000,
    };
    return defaults[key] ?? 5000;
  }),
}));

// Import after mocks
import { spawn } from "child_process";
import { readFile, stat } from "fs/promises";
import { validateProjectPath } from "../../cli/path-validator.js";
import { saveAnalysis } from "../../utils.js";
import {
  ClaudeCodeCLI,
  executeClaudeAnalysis,
  checkClaudeAvailability,
} from "../../cli/claude-code.js";
import {
  ClaudeError,
  ClaudeErrorSubType,
  SystemError,
  FileSystemError,
} from "../../errors/index.js";

/**
 * Interface for mock child process that allows property assignment
 */
interface MockChildProcess extends EventEmitter {
  stdout: ChildProcess["stdout"];
  stderr: ChildProcess["stderr"];
  stdin: ChildProcess["stdin"];
  pid: number;
  killed: boolean;
  kill: MockInstance;
}

/**
 * Creates a mock child process with EventEmitter capabilities
 * @param options - Configuration for the mock process behavior
 */
function createMockChildProcess(options: {
  exitCode?: number | null;
  stdout?: string;
  stderr?: string;
  emitError?: Error;
  exitDelay?: number;
}): ChildProcess {
  const mockProcess = new EventEmitter() as MockChildProcess;

  // Create mock streams
  const stdoutEmitter = new EventEmitter();
  const stderrEmitter = new EventEmitter();
  const stdinMock = {
    write: vi.fn(),
    end: vi.fn(),
    on: vi.fn(),
    once: vi.fn(),
    emit: vi.fn(),
  };

  mockProcess.stdout = stdoutEmitter as ChildProcess["stdout"];
  mockProcess.stderr = stderrEmitter as ChildProcess["stderr"];
  mockProcess.stdin = stdinMock as unknown as ChildProcess["stdin"];
  mockProcess.pid = 12345;
  mockProcess.killed = false;
  mockProcess.kill = vi.fn().mockReturnValue(true);

  // Schedule events after spawn returns
  setImmediate(() => {
    if (options.stdout !== undefined) {
      stdoutEmitter.emit("data", Buffer.from(options.stdout));
    }

    if (options.stderr !== undefined) {
      stderrEmitter.emit("data", Buffer.from(options.stderr));
    }

    if (options.emitError) {
      mockProcess.emit("error", options.emitError);
    } else {
      const delay = options.exitDelay ?? 0;
      setTimeout(() => {
        mockProcess.emit("close", options.exitCode ?? 0);
      }, delay);
    }
  });

  return mockProcess as unknown as ChildProcess;
}

describe("ClaudeCodeCLI", () => {
  const spawnMock = vi.mocked(spawn);
  const validateProjectPathMock = vi.mocked(validateProjectPath);
  const originalClaudeCliPath = process.env.CLAUDE_CLI_PATH;

  beforeEach(() => {
    vi.clearAllMocks();
    validateProjectPathMock.mockResolvedValue("/valid/project/path");
    // Set explicit path to avoid auto-detection search
    process.env.CLAUDE_CLI_PATH = "claude";
  });

  afterEach(() => {
    vi.restoreAllMocks();
    // Restore original value
    if (originalClaudeCliPath === undefined) {
      delete process.env.CLAUDE_CLI_PATH;
    } else {
      process.env.CLAUDE_CLI_PATH = originalClaudeCliPath;
    }
  });

  describe("isAvailable()", () => {
    it("should return true when CLAUDE_CLI_PATH is set", async () => {
      // CLAUDE_CLI_PATH is set in beforeEach, so isAvailable trusts it
      const cli = new ClaudeCodeCLI();
      const result = await cli.isAvailable();

      expect(result).toBe(true);
      // No spawn call expected when explicit path is provided
      expect(spawnMock).not.toHaveBeenCalled();
    });

    it("should return false when CLI exits with non-zero code", async () => {
      // Clear explicit path to trigger auto-detection
      delete process.env.CLAUDE_CLI_PATH;

      // Use mockImplementation to return a fresh mock for each spawn call
      spawnMock.mockImplementation(() =>
        createMockChildProcess({ exitCode: 1 })
      );

      const cli = new ClaudeCodeCLI();
      const result = await cli.isAvailable();

      expect(result).toBe(false);
    });

    it("should return false when spawn emits error", async () => {
      // Clear explicit path to trigger auto-detection
      delete process.env.CLAUDE_CLI_PATH;

      // Use mockImplementation to return a fresh mock for each spawn call
      spawnMock.mockImplementation(() =>
        createMockChildProcess({
          emitError: new Error("Command not found"),
        })
      );

      const cli = new ClaudeCodeCLI();
      const result = await cli.isAvailable();

      expect(result).toBe(false);
    });

    it("should return false on timeout", async () => {
      // Clear explicit path to trigger auto-detection
      delete process.env.CLAUDE_CLI_PATH;
      vi.useFakeTimers();

      try {
        // Track all kill mocks from spawned processes
        const killMocks: MockInstance[] = [];

        // Create a never-resolving process for each spawn call
        spawnMock.mockImplementation(() => {
          const proc = new EventEmitter() as MockChildProcess;
          proc.kill = vi.fn().mockReturnValue(true);
          proc.pid = 12345;
          proc.killed = false;
          killMocks.push(proc.kill);
          return proc as unknown as ChildProcess;
        });

        const cli = new ClaudeCodeCLI();
        const resultPromise = cli.isAvailable();

        // Advance past all candidate timeouts (5 candidates × 5000ms = 25000ms)
        // Plus buffer for each iteration
        await vi.advanceTimersByTimeAsync(30000);

        const result = await resultPromise;

        expect(result).toBe(false);
        // At least one process should have been killed due to timeout
        expect(killMocks.some((kill) => kill.mock.calls.length > 0)).toBe(true);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("execute()", () => {
    it("should return successful result with stdout output", async () => {
      const expectedOutput = "Analysis result from Claude";
      const mockProcess = createMockChildProcess({
        exitCode: 0,
        stdout: expectedOutput,
      });
      spawnMock.mockReturnValue(mockProcess);

      const cli = new ClaudeCodeCLI();
      const result = await cli.execute(
        "/test/project",
        "Analyze this code",
        { timeout: 5000 }
      );

      expect(result.output).toBe(expectedOutput);
      expect(result.exitCode).toBe(0);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it("should validate project path before execution", async () => {
      const mockProcess = createMockChildProcess({
        exitCode: 0,
        stdout: "result",
      });
      spawnMock.mockReturnValue(mockProcess);

      const cli = new ClaudeCodeCLI();
      await cli.execute("/test/project", "prompt");

      expect(validateProjectPathMock).toHaveBeenCalledWith("/test/project");
    });

    it("should throw error on timeout", async () => {
      vi.useFakeTimers();

      try {
        const processEmitter = new EventEmitter() as MockChildProcess;
        processEmitter.kill = vi.fn().mockReturnValue(true);
        processEmitter.pid = 12345;
        processEmitter.killed = false;
        processEmitter.stdout = new EventEmitter() as ChildProcess["stdout"];
        processEmitter.stderr = new EventEmitter() as ChildProcess["stderr"];
        processEmitter.stdin = {
          write: vi.fn(),
          end: vi.fn(),
          on: vi.fn(),
          once: vi.fn(),
          emit: vi.fn(),
        } as unknown as ChildProcess["stdin"];

        spawnMock.mockReturnValue(processEmitter as unknown as ChildProcess);

        const cli = new ClaudeCodeCLI();
        const executePromise = cli.execute(
          "/test/project",
          "prompt",
          { timeout: TEST_TIMEOUT }
        );

        // Add catch handler to prevent unhandled rejection warning
        let error: Error | undefined;
        executePromise.catch((e: Error) => {
          error = e;
        });

        // Advance past timeout and wait for all timers
        await vi.advanceTimersByTimeAsync(TEST_TIMEOUT + 500);
        // Allow microtasks to complete
        await vi.runAllTimersAsync();

        expect(error).toBeDefined();
        expect(error?.message).toMatch(
          new RegExp(`Claude Code CLI timeout after ${TEST_TIMEOUT}ms`)
        );
        expect(processEmitter.kill).toHaveBeenCalledWith("SIGTERM");
      } finally {
        vi.useRealTimers();
      }
    });

    it("should throw error when spawn fails", async () => {
      const mockProcess = createMockChildProcess({
        emitError: new Error("ENOENT: command not found"),
      });
      spawnMock.mockReturnValue(mockProcess);

      const cli = new ClaudeCodeCLI();

      await expect(cli.execute("/test/project", "prompt")).rejects.toThrow(
        /Failed to spawn Claude Code CLI/
      );
    });

    it("should throw error on non-zero exit code", async () => {
      const mockProcess = createMockChildProcess({
        exitCode: 1,
        stderr: "Some error occurred",
      });
      spawnMock.mockReturnValue(mockProcess);

      const cli = new ClaudeCodeCLI();

      await expect(cli.execute("/test/project", "prompt")).rejects.toThrow(
        /Claude Code CLI failed with exit code 1/
      );
    });

    it("should write prompt to stdin", async () => {
      const mockStdin = {
        write: vi.fn(),
        end: vi.fn(),
        on: vi.fn(),
        once: vi.fn(),
        emit: vi.fn(),
      };

      const processEmitter = new EventEmitter() as MockChildProcess;
      processEmitter.stdout = new EventEmitter() as ChildProcess["stdout"];
      processEmitter.stderr = new EventEmitter() as ChildProcess["stderr"];
      processEmitter.stdin = mockStdin as unknown as ChildProcess["stdin"];
      processEmitter.pid = 12345;
      processEmitter.killed = false;
      processEmitter.kill = vi.fn();

      spawnMock.mockReturnValue(processEmitter as unknown as ChildProcess);

      const cli = new ClaudeCodeCLI();
      const executePromise = cli.execute("/test/project", "test prompt", { timeout: 5000 });

      // Wait for async operations (validateProjectPath + findClaudeCommand)
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(mockStdin.write).toHaveBeenCalledWith("test prompt");
      expect(mockStdin.end).toHaveBeenCalled();

      // Emit result to complete the promise
      processEmitter.stdout?.emit("data", Buffer.from("output"));
      processEmitter.emit("close", 0);

      await executePromise;
    });
  });
});

describe("executeClaudeAnalysis()", () => {
  const spawnMock = vi.mocked(spawn);
  const readFileMock = vi.mocked(readFile);
  const statMock = vi.mocked(stat);
  const saveAnalysisMock = vi.mocked(saveAnalysis);
  const validateProjectPathMock = vi.mocked(validateProjectPath);

  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    // Set explicit path to avoid auto-detection search
    process.env["CLAUDE_CLI_PATH"] = "claude";
    validateProjectPathMock.mockResolvedValue("/test/project");
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it("should return analysis result on success", async () => {
    process.env["PROJECT_PATH"] = "/test/project";
    process.env["CLAUDE_TIMEOUT"] = "5000";

    const promptContent = "System prompt template";
    const analysisOutput = "Detailed analysis of the codebase";

    readFileMock.mockResolvedValue(promptContent);

    const mockProcess = createMockChildProcess({
      exitCode: 0,
      stdout: analysisOutput,
    });
    spawnMock.mockReturnValue(mockProcess);

    saveAnalysisMock.mockResolvedValue("/test/output/analysis.md");
    statMock.mockResolvedValue({ size: 1024 } as Awaited<
      ReturnType<typeof stat>
    >);

    const result = await executeClaudeAnalysis("What does this function do?");

    expect(result.summary).toContain("Detailed analysis");
    expect(result.filePath).toBe("/test/output/analysis.md");
    expect(result.fileName).toBe("analysis.md");
    expect(result.fileSize).toBe(1024);
  });

  it("should throw SystemError when PROJECT_PATH is not set", async () => {
    delete process.env["PROJECT_PATH"];

    await expect(executeClaudeAnalysis("question")).rejects.toThrow(
      SystemError
    );
    await expect(executeClaudeAnalysis("question")).rejects.toThrow(
      /PROJECT_PATH not specified/
    );
  });

  it("should throw ClaudeError with FileSystemError as cause when prompt file is not found", async () => {
    process.env["PROJECT_PATH"] = "/test/project";

    const readError = new Error("ENOENT: no such file or directory");
    readFileMock.mockRejectedValue(readError);

    try {
      await executeClaudeAnalysis("question");
      expect.fail("Should have thrown");
    } catch (error) {
      // executeClaudeAnalysis wraps FileSystemError in ClaudeError
      expect(error).toBeInstanceOf(ClaudeError);
      const claudeError = error as ClaudeError;
      expect(claudeError.message).toContain("Failed to load prompt file");
      expect(claudeError.originalError).toBeInstanceOf(FileSystemError);
    }
  });

  it("should throw ClaudeError when execution fails", async () => {
    process.env["PROJECT_PATH"] = "/test/project";

    readFileMock.mockResolvedValue("prompt template");

    const mockProcess = createMockChildProcess({
      exitCode: 1,
      stderr: "Execution failed",
    });
    spawnMock.mockReturnValue(mockProcess);

    await expect(executeClaudeAnalysis("question")).rejects.toThrow(
      ClaudeError
    );
  });

  it("should create truncated summary for long output", async () => {
    process.env["PROJECT_PATH"] = "/test/project";

    const longOutput = "A".repeat(500);
    readFileMock.mockResolvedValue("prompt");

    const mockProcess = createMockChildProcess({
      exitCode: 0,
      stdout: longOutput,
    });
    spawnMock.mockReturnValue(mockProcess);

    saveAnalysisMock.mockResolvedValue("/output/analysis.md");
    statMock.mockResolvedValue({ size: 500 } as Awaited<
      ReturnType<typeof stat>
    >);

    const result = await executeClaudeAnalysis("question");

    expect(result.summary.length).toBeLessThanOrEqual(303); // 300 + "..."
    expect(result.summary.endsWith("...")).toBe(true);
  });
});

describe("checkClaudeAvailability()", () => {
  const spawnMock = vi.mocked(spawn);
  const originalClaudeCliPath = process.env.CLAUDE_CLI_PATH;

  beforeEach(() => {
    vi.clearAllMocks();
    // Set explicit path to avoid auto-detection search
    process.env.CLAUDE_CLI_PATH = "claude";
  });

  afterEach(() => {
    vi.restoreAllMocks();
    // Restore original value
    if (originalClaudeCliPath === undefined) {
      delete process.env.CLAUDE_CLI_PATH;
    } else {
      process.env.CLAUDE_CLI_PATH = originalClaudeCliPath;
    }
  });

  it("should return available: true when CLI is available", async () => {
    // With CLAUDE_CLI_PATH set, no spawn is needed - it trusts the path
    const result = await checkClaudeAvailability();

    expect(result.available).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it("should return available: false with error message when CLI is not available", async () => {
    // Clear path to trigger auto-detection
    delete process.env.CLAUDE_CLI_PATH;

    // All candidates fail
    spawnMock.mockImplementation(() =>
      createMockChildProcess({ exitCode: 1 })
    );

    const result = await checkClaudeAvailability();

    expect(result.available).toBe(false);
    expect(result.error).toContain("Claude CLI not found");
    expect(result.error).toContain("npm install -g");
  });
});

describe("determineClaudeErrorSubType", () => {
  const spawnMock = vi.mocked(spawn);
  const readFileMock = vi.mocked(readFile);
  const validateProjectPathMock = vi.mocked(validateProjectPath);

  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    process.env["PROJECT_PATH"] = "/test/project";
    // Set explicit path to avoid auto-detection search
    process.env["CLAUDE_CLI_PATH"] = "claude";
    validateProjectPathMock.mockResolvedValue("/test/project");
    readFileMock.mockResolvedValue("prompt");
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it("should return TIMEOUT for timeout-related errors", async () => {
    vi.useFakeTimers();

    try {
      const processEmitter = new EventEmitter() as MockChildProcess;
      processEmitter.kill = vi.fn().mockReturnValue(true);
      processEmitter.pid = 12345;
      processEmitter.killed = false;
      processEmitter.stdout = new EventEmitter() as ChildProcess["stdout"];
      processEmitter.stderr = new EventEmitter() as ChildProcess["stderr"];
      processEmitter.stdin = {
        write: vi.fn(),
        end: vi.fn(),
        on: vi.fn(),
        once: vi.fn(),
        emit: vi.fn(),
      } as unknown as ChildProcess["stdin"];

      spawnMock.mockReturnValue(processEmitter as unknown as ChildProcess);

      const promise = executeClaudeAnalysis("question");

      // Add catch handler to prevent unhandled rejection warning
      let error: unknown;
      promise.catch((e: unknown) => {
        error = e;
      });

      // Advance past the 300000ms default timeout
      await vi.advanceTimersByTimeAsync(310000);
      // Allow microtasks to complete
      await vi.runAllTimersAsync();

      expect(error).toBeInstanceOf(ClaudeError);
      expect((error as ClaudeError).subType).toBe(ClaudeErrorSubType.TIMEOUT);
    } finally {
      vi.useRealTimers();
    }
  });

  it("should return UNAVAILABLE for 'not found' errors", async () => {
    const mockProcess = createMockChildProcess({
      emitError: new Error("spawn npx ENOENT: not found"),
    });
    spawnMock.mockReturnValue(mockProcess);

    try {
      await executeClaudeAnalysis("question");
      expect.fail("Should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(ClaudeError);
      expect((error as ClaudeError).subType).toBe(
        ClaudeErrorSubType.UNAVAILABLE
      );
    }
  });

  it("should return EXECUTION for other errors", async () => {
    const mockProcess = createMockChildProcess({
      exitCode: 1,
      stderr: "Some random execution error",
    });
    spawnMock.mockReturnValue(mockProcess);

    try {
      await executeClaudeAnalysis("question");
      expect.fail("Should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(ClaudeError);
      expect((error as ClaudeError).subType).toBe(ClaudeErrorSubType.EXECUTION);
    }
  });
});
