import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Stats } from "fs";

// Track call order for verifying execution sequence
let callOrder: string[] = [];

// Mock fs/promises before importing parser
vi.mock("fs/promises", () => ({
  readFile: vi.fn(() => {
    callOrder.push("readFile");
    return Promise.resolve("");
  }),
  readdir: vi.fn(() => {
    callOrder.push("readdir");
    return Promise.resolve([]);
  }),
  stat: vi.fn(),
  realpath: vi.fn(),
  lstat: vi.fn(),
}));

// Mock path-validator
vi.mock("../../cli/path-validator.js", () => ({
  validatePathWithinBase: vi.fn(() => {
    callOrder.push("validatePathWithinBase");
    return Promise.resolve("");
  }),
  getAllowedBasePath: vi.fn(),
}));

// Mock TypeScript compiler functions to avoid slow createProgram() and getPreEmitDiagnostics()
vi.mock("typescript", async () => {
  const actual =
    await vi.importActual<typeof import("typescript")>("typescript");
  return {
    default: {
      ...actual,
      createProgram: vi.fn(() => ({
        getSourceFile: vi.fn(),
      })),
      getPreEmitDiagnostics: vi.fn(() => []),
    },
  };
});

import { readFile, readdir, stat } from "fs/promises";
import ts from "typescript";
import { parseTypeScriptFile, findTypeScriptFiles } from "../../rag/parser.js";
import {
  validatePathWithinBase,
  getAllowedBasePath,
} from "../../cli/path-validator.js";

// Type-safe mock references
const mockReadFile = vi.mocked(readFile);
const mockReaddir = readdir as ReturnType<typeof vi.fn>;
const mockStat = vi.mocked(stat);
const mockValidatePathWithinBase = vi.mocked(validatePathWithinBase);
const mockGetAllowedBasePath = vi.mocked(getAllowedBasePath);
const mockGetPreEmitDiagnostics = vi.mocked(ts.getPreEmitDiagnostics);

// =============================================================================
// Test Fixtures - TypeScript Code Samples
// =============================================================================

const FIXTURE_FUNCTION_DECLARATION = `
export function greet(name: string): string {
  return \`Hello, \${name}!\`;
}
`;

const FIXTURE_CLASS_DECLARATION = `
export class UserService {
  private users: Map<string, User> = new Map();

  getUser(id: string): User | undefined {
    return this.users.get(id);
  }

  addUser(user: User): void {
    this.users.set(user.id, user);
  }
}
`;

const FIXTURE_INTERFACE_DECLARATION = `
export interface User {
  readonly id: string;
  name: string;
  email: string;
  createdAt: Date;
}
`;

const FIXTURE_TYPE_ALIAS = `
export type UserId = string;
export type UserRole = "admin" | "user" | "guest";
`;

const FIXTURE_ENUM_DECLARATION = `
export enum Status {
  PENDING = "pending",
  ACTIVE = "active",
  INACTIVE = "inactive",
}
`;

const FIXTURE_VARIABLE_STATEMENT = `
export const MAX_USERS = 1000;
export const DEFAULT_TIMEOUT = 5000;
`;

const FIXTURE_MIXED_DECLARATIONS = `
import { Something } from "somewhere";

export interface Config {
  timeout: number;
}

export type Handler = (event: Event) => void;

export const VERSION = "1.0.0";

export function processEvent(event: Event): void {
  console.log(event);
}

export class EventProcessor {
  process(event: Event): void {
    // implementation
  }
}

export enum EventType {
  CLICK = "click",
  HOVER = "hover",
}
`;

const FIXTURE_SYNTAX_ERROR = `
export function broken(: string {
  return "missing parameter name";
}
`;

const FIXTURE_EMPTY_FILE = "";

const FIXTURE_WHITESPACE_ONLY = "   \n\t\n   ";

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Create a mock Stats object for file
 */
function createFileStats(): Stats {
  return {
    isFile: () => true,
    isDirectory: () => false,
    isBlockDevice: () => false,
    isCharacterDevice: () => false,
    isSymbolicLink: () => false,
    isFIFO: () => false,
    isSocket: () => false,
    dev: 0,
    ino: 0,
    mode: 0,
    nlink: 0,
    uid: 0,
    gid: 0,
    rdev: 0,
    size: 0,
    blksize: 0,
    blocks: 0,
    atimeMs: 0,
    mtimeMs: 0,
    ctimeMs: 0,
    birthtimeMs: 0,
    atime: new Date(),
    mtime: new Date(),
    ctime: new Date(),
    birthtime: new Date(),
  };
}

/**
 * Create a mock Stats object for directory
 */
function createDirectoryStats(): Stats {
  return {
    ...createFileStats(),
    isFile: () => false,
    isDirectory: () => true,
  };
}

/**
 * Setup common mocks for parseTypeScriptFile tests
 */
function setupParserMocks(
  content: string,
  filePath = "/project/src/file.ts"
): void {
  mockGetAllowedBasePath.mockReturnValue("/project");
  mockValidatePathWithinBase.mockImplementation(() => {
    callOrder.push("validatePathWithinBase");
    return Promise.resolve(filePath);
  });
  mockReadFile.mockImplementation(() => {
    callOrder.push("readFile");
    return Promise.resolve(content);
  });
}

/**
 * Setup common mocks for findTypeScriptFiles tests
 */
function setupFinderMocks(): void {
  mockGetAllowedBasePath.mockReturnValue("/project");
  mockValidatePathWithinBase.mockImplementation(() => {
    callOrder.push("validatePathWithinBase");
    return Promise.resolve("/project/src");
  });
}

// =============================================================================
// Tests
// =============================================================================

describe("parser.ts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    callOrder = [];
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe("parseTypeScriptFile", () => {
    describe("entity extraction", () => {
      it("should extract function declaration as ParsedEntity with type 'function'", async () => {
        const filePath = "/project/src/greet.ts";
        setupParserMocks(FIXTURE_FUNCTION_DECLARATION, filePath);

        const result = await parseTypeScriptFile(filePath);

        expect(result).toHaveLength(1);
        const first = result[0]!;
        expect(first).toMatchObject({
          name: "greet",
          type: "function",
          filePath,
        });
        expect(first.code).toContain("export function greet");
        expect(first.startLine).toBeGreaterThan(0);
        expect(first.endLine).toBeGreaterThanOrEqual(first.startLine);
      });

      it("should extract class declaration as ParsedEntity with type 'class'", async () => {
        const filePath = "/project/src/user-service.ts";
        setupParserMocks(FIXTURE_CLASS_DECLARATION, filePath);

        const result = await parseTypeScriptFile(filePath);

        expect(result).toHaveLength(1);
        const first = result[0]!;
        expect(first).toMatchObject({
          name: "UserService",
          type: "class",
          filePath,
        });
        expect(first.code).toContain("export class UserService");
        expect(first.code).toContain("getUser");
        expect(first.code).toContain("addUser");
      });

      it("should extract interface declaration as ParsedEntity with type 'interface'", async () => {
        const filePath = "/project/src/types.ts";
        setupParserMocks(FIXTURE_INTERFACE_DECLARATION, filePath);

        const result = await parseTypeScriptFile(filePath);

        expect(result).toHaveLength(1);
        const first = result[0]!;
        expect(first).toMatchObject({
          name: "User",
          type: "interface",
          filePath,
        });
        expect(first.code).toContain("export interface User");
      });

      it("should extract type alias as ParsedEntity with type 'type'", async () => {
        const filePath = "/project/src/types.ts";
        setupParserMocks(FIXTURE_TYPE_ALIAS, filePath);

        const result = await parseTypeScriptFile(filePath);

        expect(result).toHaveLength(2);

        const userIdType = result.find((e) => e.name === "UserId");
        const userRoleType = result.find((e) => e.name === "UserRole");

        expect(userIdType).toBeDefined();
        expect(userIdType?.type).toBe("type");

        expect(userRoleType).toBeDefined();
        expect(userRoleType?.type).toBe("type");
      });

      it("should extract enum declaration as ParsedEntity with type 'constant'", async () => {
        const filePath = "/project/src/enums.ts";
        setupParserMocks(FIXTURE_ENUM_DECLARATION, filePath);

        const result = await parseTypeScriptFile(filePath);

        expect(result).toHaveLength(1);
        const first = result[0]!;
        expect(first).toMatchObject({
          name: "Status",
          type: "constant",
          filePath,
        });
        expect(first.code).toContain("export enum Status");
      });

      it("should extract variable statement (export const) as ParsedEntity with type 'constant'", async () => {
        const filePath = "/project/src/constants.ts";
        setupParserMocks(FIXTURE_VARIABLE_STATEMENT, filePath);

        const result = await parseTypeScriptFile(filePath);

        expect(result).toHaveLength(2);

        const maxUsers = result.find((e) => e.name === "MAX_USERS");
        const timeout = result.find((e) => e.name === "DEFAULT_TIMEOUT");

        expect(maxUsers).toBeDefined();
        expect(maxUsers?.type).toBe("constant");

        expect(timeout).toBeDefined();
        expect(timeout?.type).toBe("constant");
      });

      it("should extract multiple different entity types from mixed file", async () => {
        const filePath = "/project/src/mixed.ts";
        setupParserMocks(FIXTURE_MIXED_DECLARATIONS, filePath);

        const result = await parseTypeScriptFile(filePath);

        // Should have: Config (interface), Handler (type), VERSION (constant),
        // processEvent (function), EventProcessor (class), EventType (enum = constant)
        expect(result.length).toBeGreaterThanOrEqual(6);

        const entityTypes = result.map((e) => e.type);
        expect(entityTypes).toContain("interface");
        expect(entityTypes).toContain("type");
        expect(entityTypes).toContain("constant");
        expect(entityTypes).toContain("function");
        expect(entityTypes).toContain("class");

        // Verify specific entities
        expect(result.find((e) => e.name === "Config")).toBeDefined();
        expect(result.find((e) => e.name === "Handler")).toBeDefined();
        expect(result.find((e) => e.name === "VERSION")).toBeDefined();
        expect(result.find((e) => e.name === "processEvent")).toBeDefined();
        expect(result.find((e) => e.name === "EventProcessor")).toBeDefined();
        expect(result.find((e) => e.name === "EventType")).toBeDefined();
      });
    });

    describe("edge cases", () => {
      it("should return empty array for empty file", async () => {
        const filePath = "/project/src/empty.ts";
        setupParserMocks(FIXTURE_EMPTY_FILE, filePath);

        const result = await parseTypeScriptFile(filePath);

        expect(result).toEqual([]);
      });

      it("should return empty array for whitespace-only file", async () => {
        const filePath = "/project/src/whitespace.ts";
        setupParserMocks(FIXTURE_WHITESPACE_ONLY, filePath);

        const result = await parseTypeScriptFile(filePath);

        expect(result).toEqual([]);
      });

      it("should warn and return partial results for file with syntax errors", async () => {
        const filePath = "/project/src/broken.ts";
        setupParserMocks(FIXTURE_SYNTAX_ERROR, filePath);

        // Make getPreEmitDiagnostics return syntax errors for this test
        mockGetPreEmitDiagnostics.mockReturnValueOnce([
          {
            category: ts.DiagnosticCategory.Error,
            code: 1005,
            file: undefined,
            start: undefined,
            length: undefined,
            messageText: "';' expected.",
          },
        ]);

        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

        const result = await parseTypeScriptFile(filePath);

        // Parser should warn about syntax issues
        expect(warnSpy).toHaveBeenCalled();
        const warnCall = warnSpy.mock.calls[0]?.[0] as string;
        expect(warnCall).toContain("[Parser]");
        expect(warnCall).toContain("syntax");

        // Result should be an array (possibly empty or partial)
        expect(Array.isArray(result)).toBe(true);

        warnSpy.mockRestore();
      });
    });

    describe("security", () => {
      it("should throw error when path is outside allowed base directory", async () => {
        const filePath = "/etc/passwd";
        mockGetAllowedBasePath.mockReturnValue("/project");
        mockValidatePathWithinBase.mockRejectedValue(
          new Error('Path "/etc/passwd" resolves outside allowed directory')
        );

        await expect(parseTypeScriptFile(filePath)).rejects.toThrow(
          "outside allowed directory"
        );

        expect(mockValidatePathWithinBase).toHaveBeenCalledWith(
          filePath,
          "/project"
        );
      });

      it("should call validatePathWithinBase before reading file", async () => {
        const filePath = "/project/src/safe.ts";
        setupParserMocks(FIXTURE_FUNCTION_DECLARATION, filePath);

        await parseTypeScriptFile(filePath);

        // Verify validation happens before file read using call order tracking
        expect(mockValidatePathWithinBase).toHaveBeenCalledWith(
          filePath,
          "/project"
        );
        expect(mockReadFile).toHaveBeenCalled();

        // Check call order: validatePathWithinBase should come before readFile
        const validateIndex = callOrder.indexOf("validatePathWithinBase");
        const readFileIndex = callOrder.indexOf("readFile");
        expect(validateIndex).toBeLessThan(readFileIndex);
      });
    });
  });

  describe("findTypeScriptFiles", () => {
    describe("file discovery", () => {
      it("should return paths for .ts files in directory", async () => {
        setupFinderMocks();

        mockReaddir.mockImplementation(() => {
          callOrder.push("readdir");
          return Promise.resolve(["file1.ts", "file2.ts", "readme.md"]);
        });
        mockStat
          .mockResolvedValueOnce(createFileStats()) // file1.ts
          .mockResolvedValueOnce(createFileStats()) // file2.ts
          .mockResolvedValueOnce(createFileStats()); // readme.md

        const result = await findTypeScriptFiles("/project/src");

        expect(result).toContain("/project/src/file1.ts");
        expect(result).toContain("/project/src/file2.ts");
        expect(result).not.toContain("/project/src/readme.md");
      });

      it("should return empty array for empty directory", async () => {
        setupFinderMocks();
        mockReaddir.mockResolvedValue([]);

        const result = await findTypeScriptFiles("/project/src");

        expect(result).toEqual([]);
      });

      it("should recursively find files in nested directories", async () => {
        setupFinderMocks();

        // Root directory
        mockReaddir.mockResolvedValueOnce(["utils", "index.ts"]);
        mockStat
          .mockResolvedValueOnce(createDirectoryStats()) // utils
          .mockResolvedValueOnce(createFileStats()); // index.ts

        // utils directory
        mockReaddir.mockResolvedValueOnce(["helper.ts"]);
        mockStat.mockResolvedValueOnce(createFileStats()); // helper.ts

        const result = await findTypeScriptFiles("/project/src");

        expect(result).toContain("/project/src/index.ts");
        expect(result).toContain("/project/src/utils/helper.ts");
      });
    });

    describe("directory filtering", () => {
      it("should skip node_modules directory", async () => {
        setupFinderMocks();

        mockReaddir.mockResolvedValueOnce(["node_modules", "src"]);
        mockStat
          .mockResolvedValueOnce(createDirectoryStats()) // node_modules
          .mockResolvedValueOnce(createDirectoryStats()); // src

        // src directory contents
        mockReaddir.mockResolvedValueOnce(["app.ts"]);
        mockStat.mockResolvedValueOnce(createFileStats()); // app.ts

        const result = await findTypeScriptFiles("/project");

        expect(result).toContain("/project/src/app.ts");
        // Should not traverse into node_modules
        expect(mockReaddir).toHaveBeenCalledTimes(2); // root + src only
      });

      it("should skip dist, .git and other hidden directories", async () => {
        setupFinderMocks();

        mockReaddir.mockResolvedValueOnce(["dist", ".git", ".cache", "src"]);
        mockStat
          .mockResolvedValueOnce(createDirectoryStats()) // dist
          .mockResolvedValueOnce(createDirectoryStats()) // .git
          .mockResolvedValueOnce(createDirectoryStats()) // .cache
          .mockResolvedValueOnce(createDirectoryStats()); // src

        // src directory
        mockReaddir.mockResolvedValueOnce(["main.ts"]);
        mockStat.mockResolvedValueOnce(createFileStats());

        const result = await findTypeScriptFiles("/project");

        // Only src should be traversed
        expect(mockReaddir).toHaveBeenCalledTimes(2);
        expect(result).toHaveLength(1);
        expect(result[0]).toBe("/project/src/main.ts");
      });
    });

    describe("file filtering", () => {
      it("should skip .test.ts and .spec.ts files", async () => {
        setupFinderMocks();

        mockReaddir.mockResolvedValue([
          "component.ts",
          "component.test.ts",
          "utils.spec.ts",
          "helper.ts",
        ]);
        mockStat
          .mockResolvedValueOnce(createFileStats())
          .mockResolvedValueOnce(createFileStats())
          .mockResolvedValueOnce(createFileStats())
          .mockResolvedValueOnce(createFileStats());

        const result = await findTypeScriptFiles("/project/src");

        expect(result).toContain("/project/src/component.ts");
        expect(result).toContain("/project/src/helper.ts");
        expect(result).not.toContain("/project/src/component.test.ts");
        expect(result).not.toContain("/project/src/utils.spec.ts");
      });

      it("should skip .d.ts declaration files", async () => {
        setupFinderMocks();

        mockReaddir.mockResolvedValue([
          "types.ts",
          "globals.d.ts",
          "module.d.ts",
        ]);
        mockStat
          .mockResolvedValueOnce(createFileStats())
          .mockResolvedValueOnce(createFileStats())
          .mockResolvedValueOnce(createFileStats());

        const result = await findTypeScriptFiles("/project/src");

        expect(result).toContain("/project/src/types.ts");
        expect(result).not.toContain("/project/src/globals.d.ts");
        expect(result).not.toContain("/project/src/module.d.ts");
      });

      it("should include .tsx, .mts, .cts files", async () => {
        setupFinderMocks();

        mockReaddir.mockResolvedValue([
          "component.tsx",
          "module.mts",
          "commonjs.cts",
          "regular.ts",
        ]);
        mockStat
          .mockResolvedValueOnce(createFileStats())
          .mockResolvedValueOnce(createFileStats())
          .mockResolvedValueOnce(createFileStats())
          .mockResolvedValueOnce(createFileStats());

        const result = await findTypeScriptFiles("/project/src");

        expect(result).toHaveLength(4);
        expect(result).toContain("/project/src/component.tsx");
        expect(result).toContain("/project/src/module.mts");
        expect(result).toContain("/project/src/commonjs.cts");
        expect(result).toContain("/project/src/regular.ts");
      });
    });

    describe("depth limiting", () => {
      it("should warn and stop when max depth exceeded", async () => {
        setupFinderMocks();

        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

        // Create 21 levels of nested directories (exceeds MAX_DIRECTORY_DEPTH = 20)
        let readdirCallCount = 0;
        mockReaddir.mockImplementation(() => {
          readdirCallCount++;
          if (readdirCallCount <= 22) {
            return Promise.resolve(["nested"]);
          }
          return Promise.resolve([]);
        });
        mockStat.mockResolvedValue(createDirectoryStats());

        await findTypeScriptFiles("/project/src");

        // Should warn about max depth
        expect(warnSpy).toHaveBeenCalled();
        const warnCall = warnSpy.mock.calls.find(
          (call) =>
            typeof call[0] === "string" &&
            call[0].includes("Max directory depth")
        );
        expect(warnCall).toBeDefined();

        warnSpy.mockRestore();
      });
    });

    describe("security", () => {
      it("should throw error when directory path is outside allowed base", async () => {
        mockGetAllowedBasePath.mockReturnValue("/project");
        mockValidatePathWithinBase.mockRejectedValue(
          new Error('Path "/etc" resolves outside allowed directory')
        );

        await expect(findTypeScriptFiles("/etc")).rejects.toThrow(
          "outside allowed directory"
        );
      });

      it("should validate path before traversing directory", async () => {
        setupFinderMocks();
        mockReaddir.mockImplementation(() => {
          callOrder.push("readdir");
          return Promise.resolve([]);
        });

        await findTypeScriptFiles("/project/src");

        expect(mockValidatePathWithinBase).toHaveBeenCalledWith(
          "/project/src",
          "/project"
        );
        expect(mockReaddir).toHaveBeenCalled();

        // Check call order: validatePathWithinBase should come before readdir
        const validateIndex = callOrder.indexOf("validatePathWithinBase");
        const readdirIndex = callOrder.indexOf("readdir");
        expect(validateIndex).toBeLessThan(readdirIndex);
      });
    });
  });
});
