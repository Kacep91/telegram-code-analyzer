import { beforeEach, afterEach, vi } from "vitest";

// Store original console methods for proper restoration
const originalConsoleLog = console.log;
const originalConsoleWarn = console.warn;
const originalConsoleError = console.error;
const originalConsoleInfo = console.info;
const originalConsoleDebug = console.debug;

beforeEach(() => {
  // Mock console methods to keep test output clean
  console.log = vi.fn();
  console.warn = vi.fn();
  console.error = vi.fn();
  console.info = vi.fn();
  console.debug = vi.fn();
});

afterEach(() => {
  // Restore original console methods for debugging
  console.log = originalConsoleLog;
  console.warn = originalConsoleWarn;
  console.error = originalConsoleError;
  console.info = originalConsoleInfo;
  console.debug = originalConsoleDebug;

  vi.clearAllMocks();
});
