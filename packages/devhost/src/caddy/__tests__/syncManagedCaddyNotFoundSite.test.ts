import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import { createManagedCaddyPaths } from "../caddyPaths";
import { createManagedCaddyNotFoundSitePaths } from "../createManagedCaddyNotFoundSitePaths";
import { managedCaddyNotFoundPageCss } from "../managedCaddyNotFoundPageCss";
import { syncManagedCaddyNotFoundSite } from "../syncManagedCaddyNotFoundSite";
import { createRegistration } from "../../utils/routeUtils";

describe("syncManagedCaddyNotFoundSite", () => {
  test("writes a styled page that lists only active routes", async () => {
    const temporaryDirectoryPath: string = await mkdtemp(join(tmpdir(), "devhost-not-found-"));
    const paths = createManagedCaddyPaths(temporaryDirectoryPath);
    const sitePaths = createManagedCaddyNotFoundSitePaths(paths.caddyDirectoryPath);

    await mkdir(paths.routesDirectoryPath, { recursive: true });
    await mkdir(paths.registrationsDirectoryPath, { recursive: true });

    await writeFile(
      join(paths.registrationsDirectoryPath, "hello.localhost_web.json"),
      createRegistration("hello.localhost", "/", 3000),
      "utf8",
    );
    await writeFile(join(paths.routesDirectoryPath, "hello.localhost_web.caddy"), "hello route", "utf8");

    await writeFile(
      join(paths.registrationsDirectoryPath, "api.localhost_api.json"),
      createRegistration("api.localhost", "/v1", 4000),
      "utf8",
    );
    await writeFile(join(paths.routesDirectoryPath, "api.localhost_api.caddy"), "api route", "utf8");

    await writeFile(
      join(paths.registrationsDirectoryPath, "legacy.localhost_legacy.json"),
      JSON.stringify(
        {
          host: "legacy.localhost",
          port: 5000,
          ownerPid: process.pid,
          createdAt: new Date().toISOString(),
        },
        null,
        2,
      ),
      "utf8",
    );
    await writeFile(join(paths.routesDirectoryPath, "legacy.localhost_legacy.caddy"), "legacy route", "utf8");

    await writeFile(
      join(paths.registrationsDirectoryPath, "pending.localhost_pending.json"),
      createRegistration("pending.localhost", "/pending", 6000),
      "utf8",
    );

    await syncManagedCaddyNotFoundSite(paths.routesDirectoryPath);

    const pageText: string = await readFile(sitePaths.pagePath, "utf8");
    const stylesheetText: string = await readFile(sitePaths.stylesheetPath, "utf8");

    expect(pageText).toContain('<link rel="stylesheet" href="/devhost-route-not-found.css">');
    expect(pageText).toContain('href="https://api.localhost/v1"');
    expect(pageText).toContain('href="https://hello.localhost/"');
    expect(pageText).toContain('href="https://legacy.localhost/"');
    expect(pageText).not.toContain("pending.localhost");
    expect(pageText.indexOf("api.localhost/v1")).toBeLessThan(pageText.indexOf("hello.localhost/"));
    expect(pageText.indexOf("hello.localhost/")).toBeLessThan(pageText.indexOf("legacy.localhost/"));
    expect(stylesheetText).toBe(managedCaddyNotFoundPageCss);
  });

  test("renders the empty state when there are no active routes", async () => {
    const temporaryDirectoryPath: string = await mkdtemp(join(tmpdir(), "devhost-not-found-empty-"));
    const paths = createManagedCaddyPaths(temporaryDirectoryPath);
    const sitePaths = createManagedCaddyNotFoundSitePaths(paths.caddyDirectoryPath);

    await mkdir(paths.routesDirectoryPath, { recursive: true });
    await mkdir(paths.registrationsDirectoryPath, { recursive: true });

    await syncManagedCaddyNotFoundSite(paths.routesDirectoryPath);

    const pageText: string = await readFile(sitePaths.pagePath, "utf8");

    expect(pageText).toContain("No devhost routes are active right now.");
  });
});
