import type { DirectoryStack, FilePageData, RecoveryOwner, RecoveryRepository, RecoveryState } from "../../types";

export const fixture_filePage: FilePageData = {
  breadcrumbs: [
    { name: "devhost", href: "/" },
    { name: "notes", href: "" },
  ],
  markdown: false,
  source: "",
  entries: [
    { name: "read me.md", href: "read%20me.md" },
    { name: "images/", href: "images/" },
  ],
};

export const fixture_markdownPage: FilePageData = {
  ...fixture_filePage,
  markdown: true,
  source:
    "# Notes\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n- [x] Complete\n\n~~Old~~\n\n<script>window.pwned = true</script>\n\n[Unsafe](javascript:alert(1))",
  entries: [],
};

export const fixture_frontMatterMarkdownPage: FilePageData = {
  ...fixture_markdownPage,
  source:
    "---\ncreated_on: 2026-11-15 07:44\nlast_modified: 2026-11-15 09:30\nstatus: current\n---\n\n# Notes\n\nIntroduction.\n\n---\n\nAfter the break.\n",
};

export const fixture_nestedFrontMatterMarkdownPage: FilePageData = {
  ...fixture_markdownPage,
  source:
    "---\ntitle: Release notes\ntags:\n  - cli\n  - docs\nowner:\n  name: Ada\n  teams: [core, docs]\nsteps:\n  - name: build\n  - name: test\nreviewer:\n---\n\n# Notes\n",
};

export const fixture_invalidFrontMatterMarkdownPage: FilePageData = {
  ...fixture_markdownPage,
  source: "---\ntitle: [unclosed\nstatus: current\n---\n\n# Notes\n",
};

export const fixture_directoryStack: DirectoryStack = {
  id: "stk-shop",
  name: "shop",
  pid: 123,
  directory: "/workspace/shop",
  manifestPath: "/workspace/shop/devhost.toml",
  startedAt: "2026-10-25T00:00:00Z",
  error: "",
  services: [
    {
      name: "web",
      directory: "/workspace/shop/frontend",
      status: "Running",
      urls: ["https://shop.localhost/", "https://shop.localhost/api/"],
    },
    { name: "worker", directory: "", status: "Not started", urls: [] },
  ],
  configs: [
    {
      path: "/workspace/shop/devhost.toml",
      kind: "manifest",
      content: 'name = "shop"\n# </script><script>alert("source")</script>',
      error: "",
    },
    {
      path: "/home/user/.config/devhost/config.toml",
      kind: "config",
      content: "",
      error: "File does not exist; defaults apply.",
    },
  ],
};

export const fixture_owner: RecoveryOwner = {
  id: "owner",
  name: "storybook",
  pid: 123,
  manifestPath: "/feature/devhost.toml",
  urls: ["https://storybook.localhost/"],
};
export const fixture_repository: RecoveryRepository = {
  id: "repo",
  name: "shop",
  selectedPath: "/main",
  switching: false,
  worktrees: [
    { path: "/main", branch: "main", head: "abc", available: true, owners: [] },
    { path: "/feature", branch: "feature", head: "def", available: true, owners: [] },
  ],
};
export const fixture_state: RecoveryState = {
  stack: "shop",
  service: "web",
  phase: "failed",
  title: "web exited",
  message: "The service exited with code 1.",
  address: "127.0.0.1:4321",
  canRestart: true,
  logs: ["Compiler failed to resolve import"],
  repositories: [fixture_repository],
};
