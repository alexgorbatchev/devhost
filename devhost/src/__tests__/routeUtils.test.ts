import { describe, expect, test } from "bun:test";

import {
  createCaddyAdminUnavailableErrorMessage,
  createCaddyReloadErrorMessage,
  ensureCaddyAdminAvailable,
} from "../routeUtils";

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
        throw new Error("Unable to connect. Is the computer able to access the url?");
      }),
    ).rejects.toThrow(
      "Caddy admin API is not available. Run 'devhost caddy start' first.\ndetail: Unable to connect.",
    );
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
