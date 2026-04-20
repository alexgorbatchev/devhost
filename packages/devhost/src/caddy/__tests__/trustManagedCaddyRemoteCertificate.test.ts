import { createHash } from "node:crypto";

import { describe, expect, test } from "bun:test";

import { createLogger } from "../../utils/createLogger";
import {
  installTrustedMacOsCertificate,
  readRemoteManagedCaddyRootCertificate,
  trustManagedCaddyRemoteCertificate,
} from "../trustManagedCaddyRemoteCertificate";
import type { ICaddyCommandResult } from "../runManagedCaddyCommand";

type CommandCall = {
  arguments_: string[];
  stdioMode: string | undefined;
};

const successfulCommandResult: ICaddyCommandResult = {
  stderr: new Uint8Array(),
  stdout: new Uint8Array(),
  success: true,
};

describe("trustManagedCaddyRemoteCertificate", () => {
  test("fetches, fingerprints, installs, and cleans up the remote root certificate", async () => {
    const certificate: Uint8Array = new TextEncoder().encode("-----BEGIN CERTIFICATE-----\nhello\n");
    const infoMessages: string[] = [];
    const logger = createLogger({
      errorSink: (): void => undefined,
      infoSink: (message: string): void => {
        infoMessages.push(message);
      },
    });
    const fingerprint: string = createHash("sha256").update(certificate).digest("hex");
    let installedCertificatePath = "";
    let removedCertificatePath = "";

    await expect(
      trustManagedCaddyRemoteCertificate("devbox", logger, {
        createTemporaryCertificateFile: async (remoteCertificate: Uint8Array): Promise<string> => {
          expect(remoteCertificate).toEqual(certificate);
          return "/tmp/devhost-remote-root.crt";
        },
        installTrustedCertificate: async (certificatePath: string): Promise<void> => {
          installedCertificatePath = certificatePath;
        },
        platform: "darwin",
        readRemoteRootCertificate: async (sshTarget: string): Promise<Uint8Array> => {
          expect(sshTarget).toBe("devbox");
          return certificate;
        },
        removeTemporaryCertificateFile: async (certificatePath: string): Promise<void> => {
          removedCertificatePath = certificatePath;
        },
      }),
    ).resolves.toBe(0);

    expect(installedCertificatePath).toBe("/tmp/devhost-remote-root.crt");
    expect(removedCertificatePath).toBe("/tmp/devhost-remote-root.crt");
    expect(infoMessages).toEqual([
      "[devhost] managed caddy remote trust may prompt for your password because installing a root CA into the system trust store is privileged.",
      `[devhost] managed caddy remote root sha256 from devbox: ${fingerprint}`,
      "[devhost] managed caddy local CA from devbox trusted.",
    ]);
  });

  test("cleans up the temporary certificate when installation fails", async () => {
    const logger = createLogger({
      errorSink: (): void => undefined,
      infoSink: (): void => undefined,
    });
    const removedPaths: string[] = [];

    await expect(
      trustManagedCaddyRemoteCertificate("devbox", logger, {
        createTemporaryCertificateFile: async (): Promise<string> => "/tmp/devhost-remote-root.crt",
        installTrustedCertificate: async (): Promise<void> => Promise.reject(new Error("install failed")),
        platform: "darwin",
        readRemoteRootCertificate: async (): Promise<Uint8Array> => new TextEncoder().encode("cert"),
        removeTemporaryCertificateFile: async (certificatePath: string): Promise<void> => {
          removedPaths.push(certificatePath);
        },
      }),
    ).rejects.toThrow("install failed");

    expect(removedPaths).toEqual(["/tmp/devhost-remote-root.crt"]);
  });

  test("rejects non-macOS local trust installation", async () => {
    const logger = createLogger({
      errorSink: (): void => undefined,
      infoSink: (): void => undefined,
    });

    await expect(trustManagedCaddyRemoteCertificate("devbox", logger, { platform: "linux" })).rejects.toThrow(
      "Managed Caddy remote trust is currently supported on macOS only.",
    );
  });
});

describe("readRemoteManagedCaddyRootCertificate", () => {
  test("runs the remote print-root-cert command over ssh", async () => {
    const commandCalls: string[][] = [];
    const certificate: Uint8Array = new TextEncoder().encode("cert");

    await expect(
      readRemoteManagedCaddyRootCertificate("devbox", {
        runExternalCommand: (arguments_: string[]): ICaddyCommandResult => {
          commandCalls.push(arguments_);
          return {
            ...successfulCommandResult,
            stdout: certificate,
          };
        },
      }),
    ).resolves.toEqual(certificate);

    expect(commandCalls).toEqual([["ssh", "devbox", "devhost", "caddy", "print-root-cert"]]);
  });

  test("includes remote command output when ssh fetch fails", async () => {
    await expect(
      readRemoteManagedCaddyRootCertificate("devbox", {
        runExternalCommand: (): ICaddyCommandResult => ({
          stderr: new TextEncoder().encode("ssh: Could not resolve hostname devbox"),
          stdout: new Uint8Array(),
          success: false,
        }),
      }),
    ).rejects.toThrow(
      "Failed to fetch the managed Caddy root certificate from devbox. Check SSH access and confirm 'devhost' is installed on the remote host.\nssh: Could not resolve hostname devbox",
    );
  });
});

describe("installTrustedMacOsCertificate", () => {
  test("uses sudo when the current process is not root", async () => {
    const commandCalls: CommandCall[] = [];

    await expect(
      installTrustedMacOsCertificate("/tmp/root.crt", {
        isRootUser: (): boolean => false,
        runExternalCommand: (arguments_: string[], options): ICaddyCommandResult => {
          commandCalls.push({
            arguments_,
            stdioMode: options?.stdioMode,
          });
          return successfulCommandResult;
        },
      }),
    ).resolves.toBeUndefined();

    expect(commandCalls).toEqual([
      {
        arguments_: [
          "sudo",
          "security",
          "add-trusted-cert",
          "-d",
          "-r",
          "trustRoot",
          "-k",
          "/Library/Keychains/System.keychain",
          "/tmp/root.crt",
        ],
        stdioMode: "inherit",
      },
    ]);
  });

  test("omits sudo when already running as root", async () => {
    const commandCalls: string[][] = [];

    await expect(
      installTrustedMacOsCertificate("/tmp/root.crt", {
        isRootUser: (): boolean => true,
        keychainPath: "/custom.keychain",
        runExternalCommand: (arguments_: string[]): ICaddyCommandResult => {
          commandCalls.push(arguments_);
          return successfulCommandResult;
        },
      }),
    ).resolves.toBeUndefined();

    expect(commandCalls).toEqual([
      ["security", "add-trusted-cert", "-d", "-r", "trustRoot", "-k", "/custom.keychain", "/tmp/root.crt"],
    ]);
  });
});
