import { describe, expect, test } from "bun:test";

import { formatConfigFilePath } from "../formatConfigFilePath";

describe("formatConfigFilePath", () => {
  test.each([
    ["/home/alex/shop/devhost.toml", "/home/alex/shop", "/home/alex", "devhost.toml"],
    ["/home/alex/shop/packages/api/devhost.toml", "/home/alex/shop/", "/home/alex", "packages/api/devhost.toml"],
    ["/home/alex/.config/devhost/config.toml", "/home/alex/shop", "/home/alex", "~/.config/devhost/config.toml"],
    ["/home/alex/shopping/devhost.toml", "/home/alex/shop", "/home/alex", "~/shopping/devhost.toml"],
    ["/etc/devhost/config.toml", "/home/alex/shop", "/home/alex", "/etc/devhost/config.toml"],
    ["/home/alex/shop/devhost.toml", "", "", "/home/alex/shop/devhost.toml"],
  ])("shows %s from project %s with home %s as %s", (path, projectRootPath, homeDirectoryPath, expected) => {
    expect(formatConfigFilePath(path, projectRootPath, homeDirectoryPath)).toBe(expected);
  });
});
