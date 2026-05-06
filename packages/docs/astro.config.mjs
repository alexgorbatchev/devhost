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
      social: [{ icon: "github", label: "GitHub", href: "https://github.com/alexgorbatchev/devhost" }],
      sidebar: [
        { label: "Overview", link: "/" },
        {
          label: "Guides",
          autogenerate: { directory: "guides" },
        },
        {
          label: "Reference",
          items: [{ label: "Manifest reference", link: "/reference/devhost-example/" }],
        },
        {
          label: "Architecture",
          autogenerate: { directory: "architecture" },
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
