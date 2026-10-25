import createOxfmtConfig from "@alexgorbatchev/typescript-ai-policy/oxfmt-config";

export default createOxfmtConfig(() => ({
  ignorePatterns: [
    ".agents/**",
    ".cache/**",
    "**/node_modules/**",
    "apps/devhost/internal/devtools/dist/**",
    "docs/internal/architecture/**/*.html",
    "apps/devhost/internal/devtools/nvim/devhost-react-highlight.nvim/tests/**",
    "packages/playground/**",
  ],
}));
