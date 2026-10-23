import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": "/src" } },
  test: { include: ["tests/**/*.test.ts"], testTimeout: 30000 },
});
