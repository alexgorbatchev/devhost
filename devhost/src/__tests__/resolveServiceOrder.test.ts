import { describe, expect, test } from "bun:test";

import { resolveServiceOrder } from "../resolveServiceOrder";
import { validateManifest } from "../validateManifest";
import { getFixturePath, readFixtureToml } from "./testUtils";

describe("resolveServiceOrder", () => {
  test("returns dependency-first order", async () => {
    const manifestPath: string = getFixturePath("basic-stack", "devhost.toml");
    const manifestValue: unknown = await readFixtureToml("basic-stack", "devhost.toml");
    const manifest = validateManifest(manifestPath, manifestValue);

    expect(resolveServiceOrder(manifest)).toEqual(["db", "api", "web"]);
  });

  test("rejects dependency cycles", async () => {
    const manifestPath: string = getFixturePath("invalid-cycle", "devhost.toml");
    const manifestValue: unknown = await readFixtureToml("invalid-cycle", "devhost.toml");
    const manifest = validateManifest(manifestPath, manifestValue);

    expect(() => resolveServiceOrder(manifest)).toThrow("Dependency cycle detected: web -> api -> web");
  });
});
