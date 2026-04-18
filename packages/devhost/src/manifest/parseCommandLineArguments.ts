import { parseArgs } from "util";

export type CaddyLifecycleAction = "start" | "stop" | "trust" | "download" | "privileged-ports";

export type CommandLineArguments =
  | ICaddyLifecycleCommandLineArguments
  | ICaddyPrintRootCertificateCommandLineArguments
  | ICaddyTrustRemoteCommandLineArguments
  | IManifestCommandLineArguments;

export interface ICaddyLifecycleCommandLineArguments {
  action: CaddyLifecycleAction;
  kind: "caddy-lifecycle";
  manifestPath: string | null;
}

export interface ICaddyPrintRootCertificateCommandLineArguments {
  kind: "caddy-print-root-cert";
}

export interface ICaddyTrustRemoteCommandLineArguments {
  kind: "caddy-trust-remote";
  sshTarget: string;
}

export interface IManifestCommandLineArguments {
  kind: "manifest";
  manifestPath: string | null;
}

const caddyActionListText: string = "start, stop, trust, download, privileged-ports, print-root-cert, or trust-remote";

export function parseCommandLineArguments(rawArguments: string[]): CommandLineArguments {
  let parsed;
  try {
    parsed = parseArgs({
      args: rawArguments,
      options: {
        manifest: {
          type: "string",
        },
      },
      allowPositionals: true,
      strict: true,
    });
  } catch (error: unknown) {
    if (error instanceof Error) {
      throw error;
    }
    throw new Error(String(error));
  }

  const { values, positionals } = parsed;

  const isCaddyCommand = positionals[0] === "caddy";

  if (isCaddyCommand) {
    if (values.manifest && !values.manifest.endsWith("devhost.toml")) {
      throw new Error(`--manifest must point to a file named devhost.toml, received: ${values.manifest}`);
    }

    if (positionals.length === 1) {
      throw new Error(`Expected a caddy action: ${caddyActionListText}.`);
    }

    const action = positionals[1];

    if (action === "print-root-cert") {
      if (values.manifest) {
        throw new Error("The caddy print-root-cert command does not accept --manifest.");
      }

      if (positionals.length > 2) {
        throw new Error("The caddy print-root-cert command does not accept additional arguments.");
      }

      return {
        kind: "caddy-print-root-cert",
      };
    }

    if (action === "trust-remote") {
      if (values.manifest) {
        throw new Error("The caddy trust-remote command does not accept --manifest.");
      }

      if (positionals.length === 2) {
        throw new Error("Expected an SSH target. Example: devhost caddy trust-remote devbox");
      }

      if (positionals.length > 3) {
        throw new Error("The caddy trust-remote command accepts exactly one SSH target.");
      }

      return {
        kind: "caddy-trust-remote",
        sshTarget: positionals[2],
      };
    }

    if (
      action !== "start" &&
      action !== "stop" &&
      action !== "trust" &&
      action !== "download" &&
      action !== "privileged-ports"
    ) {
      throw new Error(`Unsupported caddy action: ${action}`);
    }

    if (positionals.length > 2) {
      throw new Error("Caddy lifecycle commands do not accept additional arguments.");
    }

    return {
      action,
      kind: "caddy-lifecycle",
      manifestPath: values.manifest ?? null,
    };
  }

  if (values.manifest) {
    if (!values.manifest.endsWith("devhost.toml")) {
      throw new Error(`--manifest must point to a file named devhost.toml, received: ${values.manifest}`);
    }

    if (positionals.length > 0) {
      throw new Error("Manifest mode does not accept a child command.");
    }

    return {
      kind: "manifest",
      manifestPath: values.manifest,
    };
  }

  return {
    kind: "manifest",
    manifestPath: null,
  };
}
