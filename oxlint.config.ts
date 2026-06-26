import createOxlintConfig from "@alexgorbatchev/typescript-ai-policy/oxlint-config";

export default createOxlintConfig(() => ({
  ignorePatterns: [
    "**/coverage/**",
    "apps/devhost/internal/devtools/dist/**",
    "apps/devhost/internal/devtools/nvim/devhost-react-highlight.nvim/tests/**",
    "packages/playground/**",
    "packages/devhost-ui/**",
  ],
}));
