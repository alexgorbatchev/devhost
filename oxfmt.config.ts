import createOxfmtConfig from "@alexgorbatchev/typescript-ai-policy/oxfmt-config";

export default createOxfmtConfig(() => ({
  ignorePatterns: [
    ".agents/**",
    ".cache/**",
    "**/node_modules/**",
    "apps/devhost/dist/**",
    "apps/devhost/target/**",
    "apps/devhost/vendor/**",
    "docs/internal/architecture/**/*.html",
    "docs/internal/ux-flows/*.html",
    "packages/playground/**",
  ],
}));
