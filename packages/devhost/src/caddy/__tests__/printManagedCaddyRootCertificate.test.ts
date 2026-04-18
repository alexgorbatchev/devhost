import { describe, expect, test } from "bun:test";

import { printManagedCaddyRootCertificate } from "../printManagedCaddyRootCertificate";

describe("printManagedCaddyRootCertificate", () => {
  test("writes the managed root certificate to stdout", async () => {
    const certificate: Uint8Array = new TextEncoder().encode("-----BEGIN CERTIFICATE-----\nhello\n");
    let stdout = "";

    await expect(
      printManagedCaddyRootCertificate({
        readFile: async (): Promise<Uint8Array> => certificate,
        rootCertificatePath: "/tmp/root.crt",
        writeStdout: (chunk: Uint8Array): void => {
          stdout = new TextDecoder().decode(chunk);
        },
      }),
    ).resolves.toBe(0);

    expect(stdout).toBe(new TextDecoder().decode(certificate));
  });

  test("fails clearly when the managed root certificate has not been generated", async () => {
    await expect(
      printManagedCaddyRootCertificate({
        readFile: async (): Promise<Uint8Array> => {
          throw Object.assign(new Error("missing"), { code: "ENOENT" });
        },
        rootCertificatePath: "/tmp/root.crt",
      }),
    ).rejects.toThrow("Managed Caddy root certificate not found at /tmp/root.crt. Run 'devhost caddy start' first.");
  });
});
