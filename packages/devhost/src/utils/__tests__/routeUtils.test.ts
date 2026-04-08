import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "bun:test";

import { createManagedCaddyPaths } from "../../caddy/caddyPaths";
import { ensureManagedCaddyConfig } from "../../caddy/ensureManagedCaddyConfig";
import {
  claimHost,
  createCaddyAdminUnavailableErrorMessage,
  createCaddyReloadErrorMessage,
  createRouteRegistrationText,
  ensureCaddyAdminAvailable,
  renderHostRouteSnippet,
} from "../routeUtils";

const temporaryDirectoryPaths: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectoryPaths.map(async (temporaryDirectoryPath: string): Promise<void> => {
      await rm(temporaryDirectoryPath, { force: true, recursive: true });
    }),
  );
  temporaryDirectoryPaths.length = 0;
});

describe("createCaddyAdminUnavailableErrorMessage", () => {
  test("returns the base message when there is no detail", () => {
    expect(createCaddyAdminUnavailableErrorMessage(null)).toBe(
      "Caddy admin API is not available. Run 'devhost caddy start' first.",
    );
  });

  test("appends the normalized detail", () => {
    expect(createCaddyAdminUnavailableErrorMessage("Unable to connect. Is the computer able to access the url?")).toBe(
      "Caddy admin API is not available. Run 'devhost caddy start' first.\ndetail: Unable to connect.",
    );
  });
});

describe("ensureCaddyAdminAvailable", () => {
  test("accepts a successful admin response", async () => {
    await expect(
      ensureCaddyAdminAvailable(async (): Promise<Response> => {
        return new Response("{}", {
          status: 200,
        });
      }),
    ).resolves.toBeUndefined();
  });

  test("wraps failed admin responses", async () => {
    await expect(
      ensureCaddyAdminAvailable(async (): Promise<Response> => {
        return new Response("nope", {
          status: 503,
          statusText: "Service Unavailable",
        });
      }),
    ).rejects.toThrow(
      "Caddy admin API is not available. Run 'devhost caddy start' first.\ndetail: HTTP 503 Service Unavailable",
    );
  });

  test("wraps thrown fetch errors", async () => {
    await expect(
      ensureCaddyAdminAvailable(async (): Promise<Response> => {
        return await Promise.reject(new Error("Unable to connect. Is the computer able to access the url?"));
      }),
    ).rejects.toThrow("Caddy admin API is not available. Run 'devhost caddy start' first.\ndetail: Unable to connect.");
  });
});

describe("createCaddyReloadErrorMessage", () => {
  test("returns the base message when caddy produced no output", () => {
    expect(createCaddyReloadErrorMessage(new Uint8Array(), new Uint8Array())).toBe(
      "Caddy reload failed. Is Caddy already running?",
    );
  });

  test("includes stderr and stdout output on failure", () => {
    const stderr: Uint8Array = new TextEncoder().encode("stderr line\n");
    const stdout: Uint8Array = new TextEncoder().encode("stdout line\n");

    expect(createCaddyReloadErrorMessage(stdout, stderr)).toBe(
      "Caddy reload failed. Is Caddy already running?\nstderr line\nstdout line",
    );
  });
});

describe("claimHost", () => {
  test("allows multiple services in the same manifest to reuse one hostname", async () => {
    const temporaryDirectoryPath: string = await mkdtemp(join(tmpdir(), "devhost-host-claim-"));
    const paths = createManagedCaddyPaths(temporaryDirectoryPath);

    temporaryDirectoryPaths.push(temporaryDirectoryPath);
    await ensureManagedCaddyConfig(paths);

    await claimHost({
      host: "hello.localhost",
      manifestPath: "/tmp/project/devhost.toml",
      registrationsDirectoryPath: paths.registrationsDirectoryPath,
    });
    await claimHost({
      host: "hello.localhost",
      manifestPath: "/tmp/project/devhost.toml",
      registrationsDirectoryPath: paths.registrationsDirectoryPath,
    });

    const claimText: string = await readFile(join(paths.hostClaimsDirectoryPath, "hello.localhost.json"), "utf8");

    expect(claimText).toContain('"manifestPath": "/tmp/project/devhost.toml"');
  });

  test("rejects a hostname claimed by another manifest", async () => {
    const temporaryDirectoryPath: string = await mkdtemp(join(tmpdir(), "devhost-host-claim-live-"));
    const paths = createManagedCaddyPaths(temporaryDirectoryPath);

    temporaryDirectoryPaths.push(temporaryDirectoryPath);
    await ensureManagedCaddyConfig(paths);
    await writeFile(
      join(paths.hostClaimsDirectoryPath, "hello.localhost.json"),
      JSON.stringify(
        {
          createdAt: new Date().toISOString(),
          host: "hello.localhost",
          manifestPath: "/tmp/other/devhost.toml",
          ownerPid: process.pid,
        },
        null,
        2,
      ),
      "utf8",
    );

    await expect(
      claimHost({
        host: "hello.localhost",
        manifestPath: "/tmp/project/devhost.toml",
        registrationsDirectoryPath: paths.registrationsDirectoryPath,
      }),
    ).rejects.toThrow("hello.localhost is already claimed by PID");
  });
});

describe("renderHostRouteSnippet", () => {
  test("renders one host-level caddy block for path-specific services and a root fallback", () => {
    const hostRouteSnippet: string = renderHostRouteSnippet([
      JSON.parse(
        createRouteRegistrationText(
          {
            appBindHost: "127.0.0.1",
            appPort: 4000,
            host: "hello.localhost",
            path: "/api/*",
            serviceName: "api",
          },
          "/tmp/project/devhost.toml",
        ),
      ),
      JSON.parse(
        createRouteRegistrationText(
          {
            appBindHost: "127.0.0.1",
            appPort: 3000,
            devtoolsControlPort: 4100,
            documentInjectionPort: 4200,
            host: "hello.localhost",
            path: "/",
            serviceName: "web",
          },
          "/tmp/project/devhost.toml",
        ),
      ),
    ]);

    expect(hostRouteSnippet).toMatchInlineSnapshot(`
      "hello.localhost {
          tls internal
      
          @devhost_control path /__devhost__/*
          handle @devhost_control {
              reverse_proxy 127.0.0.1:4100
          }
      
          handle /api/* {
              reverse_proxy 127.0.0.1:4000
          }
      
          @devhost_document header Sec-Fetch-Dest document
          handle @devhost_document {
              reverse_proxy 127.0.0.1:4200
          }
      
          handle {
              reverse_proxy 127.0.0.1:3000
          }
      }
      "
    `);
  });
});
