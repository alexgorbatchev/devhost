import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import { createManagedCaddyPaths } from "../caddyPaths";
import { createManagedCaddyNotFoundSitePaths } from "../createManagedCaddyNotFoundSitePaths";
import { managedCaddyNotFoundPageCss } from "../managedCaddyNotFoundPageCss";
import { syncManagedCaddyNotFoundSite } from "../syncManagedCaddyNotFoundSite";
import { createRouteRegistrationText } from "../../utils/routeUtils";

describe("syncManagedCaddyNotFoundSite", () => {
  test("writes a styled page that lists only active routes", async () => {
    const temporaryDirectoryPath: string = await mkdtemp(join(tmpdir(), "devhost-not-found-"));
    const paths = createManagedCaddyPaths(temporaryDirectoryPath);
    const sitePaths = createManagedCaddyNotFoundSitePaths(paths.caddyDirectoryPath);

    await mkdir(paths.routesDirectoryPath, { recursive: true });
    await mkdir(paths.registrationsDirectoryPath, { recursive: true });

    await writeFile(
      join(paths.registrationsDirectoryPath, "hello.localhost_web.json"),
      createRouteRegistrationText(
        {
          appBindHost: "127.0.0.1",
          appPort: 3000,
          host: "hello.localhost",
          path: "/",
          serviceName: "web",
        },
        "/tmp/hello/devhost.toml",
      ),
      "utf8",
    );
    await writeFile(join(paths.routesDirectoryPath, "hello.localhost.caddy"), "hello route", "utf8");

    await writeFile(
      join(paths.registrationsDirectoryPath, "api.localhost_api.json"),
      createRouteRegistrationText(
        {
          appBindHost: "127.0.0.1",
          appPort: 4000,
          host: "api.localhost",
          path: "/v1",
          serviceName: "api",
        },
        "/tmp/api/devhost.toml",
      ),
      "utf8",
    );
    await writeFile(join(paths.routesDirectoryPath, "api.localhost.caddy"), "api route", "utf8");

    await writeFile(
      join(paths.registrationsDirectoryPath, "legacy.localhost_legacy.json"),
      createRouteRegistrationText(
        {
          appBindHost: "127.0.0.1",
          appPort: 5000,
          host: "legacy.localhost",
          path: "/",
          serviceName: "legacy",
        },
        "/tmp/legacy/devhost.toml",
      ),
      "utf8",
    );
    await writeFile(join(paths.routesDirectoryPath, "legacy.localhost.caddy"), "legacy route", "utf8");

    await writeFile(
      join(paths.registrationsDirectoryPath, "pending.localhost_pending.json"),
      createRouteRegistrationText(
        {
          appBindHost: "127.0.0.1",
          appPort: 6000,
          host: "pending.localhost",
          path: "/pending",
          serviceName: "pending",
        },
        "/tmp/pending/devhost.toml",
      ),
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
