import { describe, expect, test } from "bun:test";

import { formatHomePath } from "../formatHomePath";

describe("formatHomePath", () => {
  test.each([
    ["/home/alex/projects/shop", "/home/alex", "~/projects/shop"],
    ["/Users/alex/worktrees/cart/web", "/Users/alex", "~/worktrees/cart/web"],
    ["/home/alex", "/home/alex", "~"],
    ["/home/alex/", "/home/alex/", "~/"],
    ["/home/alex/projects/shop", "/home/alex/", "~/projects/shop"],
    ["/home/alexander/shop", "/home/alex", "/home/alexander/shop"],
    ["/home/sam/shop", "/home/alex", "/home/sam/shop"],
    ["/worktrees/cart", "/home/alex", "/worktrees/cart"],
    ["/home/alex/projects/shop", "", "/home/alex/projects/shop"],
    ["/home/alex/projects/shop", "/", "/home/alex/projects/shop"],
  ])("formats %s with home %s as %s", (path, homeDirectoryPath, expected) => {
    expect(formatHomePath(path, homeDirectoryPath)).toBe(expected);
  });
});
