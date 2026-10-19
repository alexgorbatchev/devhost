import { expect, it } from "bun:test";
import { resolveDevhostConfigDirectory } from "../resolveDevhostConfigDirectory";

it.each([
  [{ DEVHOST_CONFIG_DIR: " /config ", XDG_CONFIG_HOME: "/xdg", HOME: "/home" }, "/config"],
  [{ XDG_CONFIG_HOME: " /xdg ", HOME: "/home" }, "/xdg/devhost"],
  [{ HOME: " /home " }, "/home/.config/devhost"],
])("locates the devhost config directory as devhost does: %o", (environment, expected) => {
  expect(resolveDevhostConfigDirectory(environment)).toBe(expected);
});

it("rejects an environment without a home for the devhost config directory", () => {
  expect(() => resolveDevhostConfigDirectory({ HOME: " " })).toThrow(
    "Set DEVHOST_CONFIG_DIR, XDG_CONFIG_HOME, or HOME to locate the devhost config file",
  );
});
