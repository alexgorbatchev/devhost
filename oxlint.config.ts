import createOxlintConfig from "@alexgorbatchev/typescript-ai-policy/oxlint-config";

export default createOxlintConfig(() => ({
  ignorePatterns: [
    "**/coverage/**",
    "apps/devhost/dist/**",
    "apps/devhost/target/**",
    "apps/devhost/vendor/**",
    "packages/playground/**",
  ],
}));
