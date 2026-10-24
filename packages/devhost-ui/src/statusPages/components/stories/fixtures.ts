import type { RecoveryOwner, RecoveryRepository, RecoveryState } from "../../types";

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
