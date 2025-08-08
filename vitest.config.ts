import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    setupFiles: ["./src/__tests__/setup.ts"],
    testTimeout: 220000, // 3.7 minutes - allows for 3 minute Claude calls + buffer
  },
});
