// @ts-check
import { defineConfig } from "astro/config";
import react from "@astrojs/react";
import starlight from "@astrojs/starlight";
import rehypeMermaid from "rehype-mermaid";

import { rehypeWrapMermaidDiagrams } from "./src/markdown/rehypeWrapMermaidDiagrams";
import {
  CODE_STYLE_OVERRIDES,
  DARK_CODE_THEME_PALETTE,
  LIGHT_CODE_THEME_PALETTE,
  MERMAID_RENDER_OPTIONS,
} from "./src/theme/constants";
import { createDevhostCodeTheme } from "./src/theme/createDevhostCodeTheme";

export default defineConfig({
  site: "https://alexgorbatchev.github.io",
  base: "/devhost",
  markdown: {
    rehypePlugins: [[rehypeMermaid, MERMAID_RENDER_OPTIONS], rehypeWrapMermaidDiagrams],
  },
  server: {
    allowedHosts: true,
  },
  integrations: [
    react(),
    starlight({
      title: "@alexgorbatchev/devhost",
      description: "Local HTTPS routing and developer tooling for multi-service dev stacks.",
      customCss: [
        "./src/styles/docsFontTheme.css",
        "@alexgorbatchev/devhost-design/tokens.css",
        "./src/styles/devhostTokens.css",
        "./src/styles/devhostChrome.css",
        "./src/styles/devhostContent.css",
      ],
      components: {
        SiteTitle: "./src/starlight/SiteTitle.astro",
      },
      expressiveCode: {
        themes: [createDevhostCodeTheme(DARK_CODE_THEME_PALETTE), createDevhostCodeTheme(LIGHT_CODE_THEME_PALETTE)],
        styleOverrides: CODE_STYLE_OVERRIDES,
      },
      disable404Route: true,
      social: [{ icon: "github", label: "GitHub", href: "https://github.com/alexgorbatchev/devhost" }],
      sidebar: [
        { label: "Overview", link: "/" },
        {
          label: "Get started",
          items: ["start/install", "start/how-it-works", "start/serve"],
        },
        {
          label: "Routing and HTTPS",
          items: ["guides/managed-caddy", "guides/shared-managed-caddy-settings"],
        },
        {
          label: "Stacks",
          items: [
            "guides/stack-lifecycle",
            "stacks/hot-reload",
            "stacks/recovery",
            "stacks/worktrees",
            "guides/manifest-includes",
            "guides/service-references",
            "guides/environment-variables",
            "guides/docker-backed-services",
            "guides/managed-daemon-style-services",
          ],
        },
        {
          label: "Browser devtools",
          items: [
            "guides/devtools",
            "guides/annotations",
            "guides/react-highlight",
            {
              label: "Third-party devtools",
              items: [
                "integrations/redux",
                "integrations/tanstack",
                "integrations/vue",
                "integrations/react-hook-form",
                "integrations/jotai",
              ],
            },
          ],
        },
        "guides/troubleshooting",
        {
          label: "Reference",
          items: [
            "reference/cli",
            { label: "Manifest reference", link: "/reference/devhost-example/" },
            "reference/output",
            "reference/control-api",
            "reference/chat-api",
            "reference/selection-plugins",
          ],
        },
        {
          label: "Development",
          items: ["development/building", "development/page-previews", "development/release-pipeline"],
        },
      ],
    }),
  ],
  vite: {
    preview: {
      allowedHosts: true,
    },
  },
});
