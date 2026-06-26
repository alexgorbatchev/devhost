import createOxlintConfig from "@alexgorbatchev/typescript-ai-policy/oxlint-config";

export default createOxlintConfig(() => ({
  ignorePatterns: [
    "**/coverage/**",
    "apps/devhost/internal/devtools/dist/**",
    "apps/devhost/internal/devtools/nvim/devhost-react-highlight.nvim/tests/**",
    "packages/playground/**",
    "packages/devhost-ui/src/components/ui/constants.ts",
    "packages/devhost-ui/src/components/ui/DropdownMenu.tsx",
    "packages/devhost-ui/src/devtools/shared/components/FloatingPanel.tsx",
    "packages/devhost-ui/src/devtools/shared/components/HoverSlidePanel.tsx",
    "packages/devhost-ui/src/devtools/features/annotationComposer/components/AnnotationComposer.tsx",
    "packages/devhost-ui/src/devtools/features/annotationQueue/components/AnnotationQueuePanel.tsx",
  ],
}));
