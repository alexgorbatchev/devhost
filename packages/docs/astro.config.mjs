// @ts-check
import { defineConfig } from "astro/config";
import react from "@astrojs/react";
import starlight from "@astrojs/starlight";
import rehypeMermaid from "rehype-mermaid";

export default defineConfig({
  site: "https://alexgorbatchev.github.io",
  base: "/devhost",
  markdown: {
    rehypePlugins: [[rehypeMermaid, { dark: true, strategy: "img-svg" }]],
  },
  server: {
    allowedHosts: true,
  },
  integrations: [
    react(),
    starlight({
      title: "@alexgorbatchev/devhost",
      description: "Local HTTPS routing and developer tooling for multi-service dev stacks.",
      customCss: ["./src/styles/docsFontTheme.css"],
      disable404Route: true,
      social: [{ icon: "github", label: "GitHub", href: "https://github.com/alexgorbatchev/devhost" }],
      sidebar: [
        { label: "Overview", link: "/" },
        {
          label: "Routing",
          items: [
            "guides/managed-caddy",
            "guides/stack-lifecycle",
            "guides/shared-managed-caddy-settings",
            "guides/docker-backed-services",
            "guides/managed-daemon-style-services",
            "guides/injected-environment",
            "guides/troubleshooting",
          ],
        },
        {
          label: "Devtools",
          items: [
            "guides/devtools",
            "guides/annotations",
            {
              label: "Architecture",
              items: ["architecture/external-devtools", "architecture/annotations/queue"],
            },
          ],
        },
        {
          label: "Reference",
          items: [{ label: "Manifest reference", link: "/reference/devhost-example/" }],
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
