import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { resolve } from "path";
import type { Stats } from "fs";

// Mock fs/promises module before imports
vi.mock("fs/promises", () => ({
  stat: vi.fn(),
  realpath: vi.fn(),
  lstat: vi.fn(),
}));

// Import after mocking
import { stat, realpath, lstat } from "fs/promises";
import {
  getAllowedBasePath,
  validatePathWithinBase,
  validateProjectPath,
} from "../../cli/path-validator.js";

/**
 * Helper to create mock Stats object
 */
function createMockStats(isDir: boolean): Stats {
  return {
    isDirectory: () => isDir,
    isFile: () => !isDir,
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

describe("path-validator", () => {
  // Store original env
  const originalEnv = { ...process.env };

  // Get mocked functions via vi.mocked
  const mockStat = vi.mocked(stat);
  const mockRealpath = vi.mocked(realpath);
  const mockLstat = vi.mocked(lstat);

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset env before each test
    process.env = { ...originalEnv };
    delete process.env["PROJECT_PATH"];
    delete process.env["ALLOWED_PROJECT_BASE"];
  });

  afterEach(() => {
    // Restore original env
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  describe("getAllowedBasePath()", () => {
    it("should return PROJECT_PATH when set", () => {
      process.env["PROJECT_PATH"] = "/home/user/projects";

      const result = getAllowedBasePath();

      expect(result).toBe("/home/user/projects");
    });

    it("should return ALLOWED_PROJECT_BASE when PROJECT_PATH is not set", () => {
      process.env["ALLOWED_PROJECT_BASE"] = "/var/projects";

      const result = getAllowedBasePath();

      expect(result).toBe("/var/projects");
    });

    it("should throw Error when neither env var is set", () => {
      // Both are already deleted in beforeEach

      expect(() => getAllowedBasePath()).toThrow(
        "PROJECT_PATH or ALLOWED_PROJECT_BASE must be set"
      );
    });

    it("should prefer PROJECT_PATH over ALLOWED_PROJECT_BASE when both set", () => {
      process.env["PROJECT_PATH"] = "/primary/path";
      process.env["ALLOWED_PROJECT_BASE"] = "/fallback/path";

      const result = getAllowedBasePath();

      expect(result).toBe("/primary/path");
    });
  });

  describe("validatePathWithinBase()", () => {
    const basePath = "/home/user/projects";
    const validTargetPath = "/home/user/projects/my-app";

    it("should return real path when target is within base", async () => {
      // Mock realpath for base
      mockRealpath.mockImplementation(async (path) => {
        const pathStr = String(path);
        if (pathStr === resolve(basePath)) return basePath;
        if (pathStr === resolve(validTargetPath)) return validTargetPath;
        throw new Error("ENOENT");
      });

      // Mock lstat - target exists
      mockLstat.mockResolvedValue(createMockStats(true));

      const result = await validatePathWithinBase(validTargetPath, basePath);

      expect(result).toBe(validTargetPath);
      expect(mockRealpath).toHaveBeenCalledWith(resolve(basePath));
      expect(mockLstat).toHaveBeenCalledWith(resolve(validTargetPath));
    });

    it("should throw Error when path is outside base directory", async () => {
      const outsidePath = "/etc/passwd";

      // Mock realpath
      mockRealpath.mockImplementation(async (path) => {
        const pathStr = String(path);
        if (pathStr === resolve(basePath)) return basePath;
        if (pathStr === resolve(outsidePath)) return outsidePath;
        throw new Error("ENOENT");
      });

      // Mock lstat - target exists
      mockLstat.mockResolvedValue(createMockStats(false));

      await expect(
        validatePathWithinBase(outsidePath, basePath)
      ).rejects.toThrow(
        'Path "/etc/passwd" resolves outside allowed directory'
      );
    });

    it("should throw Error for symlink attack (realpath differs)", async () => {
      const symlinkPath = "/home/user/projects/sneaky-link";
      const realTargetOutside = "/etc/shadow";

      // Mock realpath - symlink resolves to outside directory
      mockRealpath.mockImplementation(async (path) => {
        const pathStr = String(path);
        if (pathStr === resolve(basePath)) return basePath;
        if (pathStr === resolve(symlinkPath)) return realTargetOutside;
        throw new Error("ENOENT");
      });

      // Mock lstat - symlink exists
      mockLstat.mockResolvedValue(createMockStats(false));

      await expect(
        validatePathWithinBase(symlinkPath, basePath)
      ).rejects.toThrow(
        `Path "${symlinkPath}" resolves outside allowed directory`
      );
    });

    it("should validate parent directory when target does not exist", async () => {
      const nonExistentPath = "/home/user/projects/new-file.ts";
      const parentPath = "/home/user/projects";

      // Mock realpath
      mockRealpath.mockImplementation(async (path) => {
        const pathStr = String(path);
        if (pathStr === resolve(basePath)) return basePath;
        if (pathStr === resolve(parentPath)) return parentPath;
        throw new Error("ENOENT");
      });

      // Mock lstat - target does not exist
      mockLstat.mockRejectedValue(new Error("ENOENT"));

      const result = await validatePathWithinBase(nonExistentPath, basePath);

      expect(result).toBe(resolve(nonExistentPath));
    });
  });

  describe("validateProjectPath()", () => {
    const basePath = "/home/user/projects";
    const validProjectPath = "/home/user/projects/my-app";

    beforeEach(() => {
      process.env["PROJECT_PATH"] = basePath;
    });

    it("should return validated path for valid directory", async () => {
      // Mock realpath
      mockRealpath.mockImplementation(async (path) => {
        const pathStr = String(path);
        if (pathStr === resolve(basePath)) return basePath;
        if (pathStr === resolve(validProjectPath)) return validProjectPath;
        if (pathStr === validProjectPath) return validProjectPath;
        throw new Error("ENOENT");
      });

      // Mock lstat - exists
      mockLstat.mockResolvedValue(createMockStats(true));

      // Mock stat - is directory
      mockStat.mockResolvedValue(createMockStats(true));

      const result = await validateProjectPath(validProjectPath);

      expect(result).toBe(validProjectPath);
    });

    it("should throw Error when path is not a directory (is a file)", async () => {
      const filePath = "/home/user/projects/config.json";

      // Mock realpath
      mockRealpath.mockImplementation(async (path) => {
        const pathStr = String(path);
        if (pathStr === resolve(basePath)) return basePath;
        if (pathStr === resolve(filePath)) return filePath;
        if (pathStr === filePath) return filePath;
        throw new Error("ENOENT");
      });

      // Mock lstat - exists
      mockLstat.mockResolvedValue(createMockStats(false));

      // Mock stat - is file, not directory
      mockStat.mockResolvedValue(createMockStats(false));

      await expect(validateProjectPath(filePath)).rejects.toThrow(
        `Project path is not a directory: ${filePath}`
      );
    });

    it("should throw Error for symlink to directory outside base", async () => {
      const symlinkPath = "/home/user/projects/malicious-link";
      const outsideDir = "/tmp/evil";

      // Mock realpath - first call returns symlink target inside base,
      // but final check returns outside path (simulating TOCTOU attack)
      let realpathCallCount = 0;
      mockRealpath.mockImplementation(async (path) => {
        realpathCallCount++;
        const pathStr = String(path);
        if (pathStr === resolve(basePath)) return basePath;
        if (pathStr === basePath) return basePath;
        // First calls return valid path, final check returns outside
        if (pathStr === resolve(symlinkPath)) {
          return realpathCallCount <= 2 ? symlinkPath : outsideDir;
        }
        if (pathStr === symlinkPath) return outsideDir;
        throw new Error("ENOENT");
      });

      // Mock lstat - exists
      mockLstat.mockResolvedValue(createMockStats(true));

      // Mock stat - is directory
      mockStat.mockResolvedValue(createMockStats(true));

      await expect(validateProjectPath(symlinkPath)).rejects.toThrow(
        `Path "${symlinkPath}" changed during validation - possible symlink attack`
      );
    });

    it("should throw Error for non-existent path", async () => {
      const nonExistentPath = "/home/user/projects/does-not-exist";
      const parentPath = "/home/user/projects";

      // Mock realpath
      mockRealpath.mockImplementation(async (path) => {
        const pathStr = String(path);
        if (pathStr === resolve(basePath)) return basePath;
        if (pathStr === resolve(parentPath)) return parentPath;
        throw new Error("ENOENT: no such file or directory");
      });

      // Mock lstat - does not exist
      mockLstat.mockRejectedValue(new Error("ENOENT"));

      // Mock stat - does not exist
      mockStat.mockRejectedValue(
        new Error("ENOENT: no such file or directory")
      );

      await expect(validateProjectPath(nonExistentPath)).rejects.toThrow();
    });
  });
});
