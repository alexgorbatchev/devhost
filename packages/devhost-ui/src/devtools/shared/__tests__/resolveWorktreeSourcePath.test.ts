import { expect, test } from "bun:test";

import { resolveWorktreeSourcePath } from "../resolveWorktreeSourcePath";
import { factory_worktreeRepository } from "../../features/serviceStatusPanel/components/stories/fixtures";

test("moves source metadata from previous checkouts into the selected checkout", () => {
  const repository = { ...factory_worktreeRepository(), selectedPath: "/worktrees/cart" };
  expect(resolveWorktreeSourcePath("file:///projects/shop/web/Page.tsx?version=1", repository)).toBe(
    "/worktrees/cart/web/Page.tsx",
  );
  expect(resolveWorktreeSourcePath("/worktrees/experiment/api/Route.tsx", repository)).toBe(
    "/worktrees/cart/api/Route.tsx",
  );
  expect(resolveWorktreeSourcePath("/worktrees/cart/web/Page.tsx", repository)).toBe("/worktrees/cart/web/Page.tsx");
  expect(resolveWorktreeSourcePath("/projects/shop-other/web/Page.tsx", repository)).toBe(
    "/projects/shop-other/web/Page.tsx",
  );
  expect(resolveWorktreeSourcePath("webpack:///./src/Page.tsx", repository)).toBe("src/Page.tsx");
});

test("preserves sources already in a nested selected worktree", () => {
  const repository = { ...factory_worktreeRepository(), selectedPath: "/projects/shop/.workspaces/cart" };
  expect(resolveWorktreeSourcePath("/projects/shop/.workspaces/cart/web/Page.tsx", repository)).toBe(
    "/projects/shop/.workspaces/cart/web/Page.tsx",
  );
  expect(resolveWorktreeSourcePath("/projects/shop/web/Page.tsx", repository)).toBe(
    "/projects/shop/.workspaces/cart/web/Page.tsx",
  );
});
