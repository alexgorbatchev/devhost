import { defineConfig } from "ts-unused";

export default defineConfig({
  testFilePatterns: ["**/*.test.ts", "**/*.test.tsx", "**/*.spec.ts", "**/*.spec.tsx", "**/__tests__/**"],
  ignoreFilePatterns: ["**/stories/**", "**/.storybook/**"],
  packageMode: true,
});
