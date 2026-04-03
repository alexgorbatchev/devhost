import createOxlintConfig from "@alexgorbatchev/typescript-ai-policy/oxlint-config";

export default createOxlintConfig(() => ({
  ignorePatterns: ["coverage", "**/__tests__/use*.test.ts", "**/__tests__/use*.test.tsx"],
}));
